import fs from 'node:fs';
import path from 'node:path';
import { Effect } from 'effect';
import { createEngineClient } from './engine-client.ts';
import { getServiceStartCommand } from './service/environment.ts';
import { getServiceLogFile, getServicePaths } from './service/paths.ts';

export function isConnectionRefused(cause: unknown): boolean {
	if (typeof cause !== 'object' || cause === null) return false;
	return (
		('code' in cause &&
			(cause.code === 'ECONNREFUSED' || cause.code === 'ConnectionRefused')) ||
		('cause' in cause && isConnectionRefused(cause.cause))
	);
}

export function retryEngineRpc<A, E, R = never>(
	call: () => Promise<A>,
	ensure: Effect.Effect<void, E, R>,
) {
	const request = Effect.tryPromise({
		try: call,
		catch: (cause) =>
			new Error(cause instanceof Error ? cause.message : String(cause), {
				cause,
			}),
	});
	return request.pipe(
		Effect.catch((error) =>
			isConnectionRefused(error)
				? ensure.pipe(Effect.andThen(request))
				: Effect.fail(error),
		),
	);
}

export function engineSpawnEnvironment(port: string) {
	return { ...process.env, OPENCODE_MCP_PORT: port };
}

export function ensureEngine(url: string, idleExit = '10m') {
	return Effect.gen(function* () {
		const client = createEngineClient(url);
		const probe = Effect.tryPromise(() => client.aliases.list());
		const first = yield* Effect.result(probe);
		if (first._tag === 'Success') return;
		const parsed = yield* Effect.try(() => new URL(url));
		if (
			!isConnectionRefused(first.failure) ||
			!['localhost', '127.0.0.1'].includes(parsed.hostname)
		)
			return yield* Effect.fail(first.failure);
		const command = yield* getServiceStartCommand();
		const logFile = yield* getServiceLogFile;
		const enginePidPath = (yield* getServicePaths()).enginePidPath;
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
					logFile,
				],
				{
					env: engineSpawnEnvironment(parsed.port || '80'),
					detached: true,
					stdin: 'ignore',
					stdout: 'ignore',
					stderr: 'ignore',
				},
			);
			child.unref();
			fs.mkdirSync(path.dirname(enginePidPath), { recursive: true });
			fs.writeFileSync(enginePidPath, `${child.pid}\n`, 'utf8');
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
