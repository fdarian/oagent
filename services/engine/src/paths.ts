import os from 'node:os';
import { Config, Effect, Option } from 'effect';
import type { ConfigError } from 'effect/Config';
import { FileSystem } from 'effect/FileSystem';
import { Path } from 'effect/Path';
import type { PlatformError } from 'effect/PlatformError';

export const getOagentBaseDir: Effect.Effect<string, never, Path> = Effect.gen(
	function* () {
		const path = yield* Path;
		return path.join(os.homedir(), '.config', 'oagent');
	},
);

export const getOagentLogsDir: Effect.Effect<string, ConfigError, Path> =
	Effect.gen(function* () {
		const path = yield* Path;
		const pathFromEnv = Option.getOrNull(
			yield* Config.String('OAGENT_LOG_DIR').pipe(Config.option),
		);
		if (pathFromEnv) {
			return path.resolve(pathFromEnv);
		}

		return path.join(os.homedir(), 'Library', 'Logs', 'com.fdarian.oagent');
	});

export const ensureOagentLogsDir: Effect.Effect<
	string,
	ConfigError | PlatformError,
	FileSystem | Path
> = Effect.gen(function* () {
	const fs = yield* FileSystem;
	const logsDir = yield* getOagentLogsDir;
	yield* fs.makeDirectory(logsDir, { recursive: true });
	return logsDir;
});
