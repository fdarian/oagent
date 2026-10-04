import { getOagentLogsDir } from '@oagent/engine';
import { Effect } from 'effect';
import { createEngineClient } from './engine-client.ts';
import { getServiceStartCommand } from './service/environment.ts';

function refused(cause: unknown): boolean {
	if (typeof cause !== 'object' || cause === null) return false;
	return (
		('code' in cause && cause.code === 'ECONNREFUSED') ||
		('cause' in cause && refused(cause.cause))
	);
}

export function ensureEngine(url: string, idleExit = '10m') {
	return Effect.gen(function* () {
		const client = createEngineClient(url);
		const probe = Effect.tryPromise(() => client.aliases.list());
		const first = yield* Effect.result(probe);
		if (first._tag === 'Success') return;
		const parsed = yield* Effect.try(() => new URL(url));
		if (
			!refused(first.failure) ||
			!['localhost', '127.0.0.1'].includes(parsed.hostname)
		)
			return yield* Effect.fail(first.failure);
		const command = yield* getServiceStartCommand();
		const logs = yield* getOagentLogsDir;
		yield* Effect.try(() => {
			const child = Bun.spawn(
				[
					...command,
					'serve',
					'--port',
					parsed.port || '80',
					'--idle-exit',
					idleExit,
					'--log-file',
					`${logs}/oagent.jsonl`,
				],
				{ detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
			);
			child.unref();
		});
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			yield* Effect.sleep(100);
			const result = yield* Effect.result(probe);
			if (result._tag === 'Success') return;
		}
		return yield* Effect.fail(
			new Error(`Engine at ${url} did not become ready within 15 seconds`),
		);
	});
}
