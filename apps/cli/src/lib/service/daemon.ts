import { Effect } from 'effect';
import { createEngineClient } from '#/lib/engine-client.ts';
import { ServiceError } from '#/lib/service/errors.ts';
import { errorMessage } from '#/lib/service/launchctl.ts';
import type { ManagedServerStatus } from '#/lib/service/process.ts';
import { parseServeArgv, type ServeArgv } from '#/lib/service/serve-argv.ts';

const RPC_TIMEOUT = '3 seconds';

export function requireServeArgv(
	status: ManagedServerStatus,
): Effect.Effect<ServeArgv, ServiceError> {
	const parsed =
		status.argv === undefined ? undefined : parseServeArgv(status.argv);
	return parsed === undefined
		? Effect.fail(
				new ServiceError({
					message: `Unable to read the arguments of the running oagent serve (pid ${status.pid})`,
				}),
			)
		: Effect.succeed(parsed);
}

function requirePort(
	argv: ServeArgv,
	action: string,
): Effect.Effect<number, ServiceError> {
	return argv.port === undefined
		? Effect.fail(
				new ServiceError({
					message: `Unable to ${action}: the running oagent serve has no --port argument`,
				}),
			)
		: Effect.succeed(argv.port);
}

function callDaemon<A>(
	argv: ServeArgv,
	action: string,
	call: (client: ReturnType<typeof createEngineClient>) => Promise<A>,
) {
	return Effect.gen(function* () {
		const port = yield* requirePort(argv, action);
		const client = createEngineClient(`http://localhost:${port}`);
		return yield* Effect.tryPromise({
			try: () => call(client),
			catch: (cause) =>
				new ServiceError({
					message: `Failed to ${action} on port ${port}: ${errorMessage(cause)}`,
				}),
		}).pipe(
			Effect.timeoutOrElse({
				duration: RPC_TIMEOUT,
				orElse: () =>
					Effect.fail(
						new ServiceError({
							message: `Timed out trying to ${action} on port ${port}`,
						}),
					),
			}),
		);
	});
}

export function isIdleExitActive(argv: ServeArgv) {
	return callDaemon(argv, 'query the daemon', (client) =>
		client.daemon.get(),
	).pipe(Effect.map((daemon) => daemon.idleExit));
}

export function disableIdleExit(argv: ServeArgv) {
	return callDaemon(argv, 'disable idle exit', (client) =>
		client.daemon.disableIdleExit(),
	);
}
