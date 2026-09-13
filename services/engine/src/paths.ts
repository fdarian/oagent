import os from 'node:os';
import { Config, Effect, Option } from 'effect';
import type { ConfigError } from 'effect/Config';
import { FileSystem } from 'effect/FileSystem';
import { Path } from 'effect/Path';
import type { PlatformError } from 'effect/PlatformError';

export const getOagentHomeDir: Effect.Effect<string, ConfigError, Path> =
	Effect.gen(function* () {
		const path = yield* Path;
		const defaultHomeDir = path.join(os.homedir(), '.config', 'oagent');
		const configuredHomeDir = Option.getOrNull(
			yield* Config.String('OAGENT_HOME_DIR').pipe(Config.option),
		);
		const homeDir =
			configuredHomeDir === null || configuredHomeDir.length === 0
				? defaultHomeDir
				: configuredHomeDir;
		return path.resolve(homeDir);
	});

export const getOagentConfigPath: Effect.Effect<string, ConfigError, Path> =
	Effect.gen(function* () {
		const path = yield* Path;
		const homeDir = yield* getOagentHomeDir;
		return path.join(homeDir, 'config.json');
	});

export const getOagentDbPath: Effect.Effect<string, ConfigError, Path> =
	Effect.gen(function* () {
		const path = yield* Path;
		const homeDir = yield* getOagentHomeDir;
		return path.join(homeDir, 'sqlite.db');
	});

export const getOagentLogsDir: Effect.Effect<string, ConfigError, Path> =
	Effect.gen(function* () {
		const path = yield* Path;
		const homeDir = yield* getOagentHomeDir;
		return path.join(homeDir, 'logs');
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
