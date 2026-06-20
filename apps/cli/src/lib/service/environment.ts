import path from 'node:path';
import { Effect } from 'effect';

export function ensureMacOs(): Effect.Effect<void, Error> {
	if (process.platform !== 'darwin') {
		return Effect.fail(
			new Error(
				`oagent service is only supported on macOS (launchd); your platform is ${process.platform}`,
			),
		);
	}
	return Effect.void;
}

export function getServiceBinaryPath(): Effect.Effect<string, Error> {
	const binaryPath = process.execPath;
	if (path.basename(binaryPath) === 'bun') {
		return Effect.fail(
			new Error(
				'`oagent service` must be run from the built `oagent` binary, not via `bun`; run `bun run build` and invoke `apps/cli/dist/oagent`.',
			),
		);
	}
	return Effect.succeed(binaryPath);
}

export function getCallerPath(): Effect.Effect<string, Error> {
	const pathEnv = process.env.PATH;
	if (pathEnv === undefined || pathEnv.length === 0) {
		return Effect.fail(
			new Error(
				'Unable to read PATH from the environment to install the service',
			),
		);
	}
	return Effect.succeed(pathEnv);
}

export function validatePort(port: number): Effect.Effect<number, Error> {
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		return Effect.fail(
			new Error(`Invalid port ${port}; expected an integer in 1..65535`),
		);
	}
	return Effect.succeed(port);
}
