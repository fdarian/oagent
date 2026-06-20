import type { PlatformError } from '@effect/platform/Error';
import { FileSystem } from '@effect/platform/FileSystem';
import { Path } from '@effect/platform/Path';
import { Config, type ConfigError, Effect, Option } from 'effect';
import { getOagentBaseDir } from '../paths.ts';

export function resolveDbPath(): Effect.Effect<
	string,
	ConfigError.ConfigError | PlatformError,
	FileSystem | Path
> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;

		const pathFromEnv = Option.getOrNull(
			yield* Config.string('OAGENT_DB_PATH').pipe(Config.option),
		);
		if (pathFromEnv) {
			const resolved = path.resolve(pathFromEnv);
			yield* fs.makeDirectory(path.dirname(resolved), { recursive: true });
			yield* Effect.logInfo(`[sqlite] using ${pathFromEnv}`);
			return resolved;
		}

		const baseDir = yield* getOagentBaseDir;
		yield* fs.makeDirectory(baseDir, { recursive: true });
		const dbPath = path.join(baseDir, 'sqlite.db');
		yield* Effect.logInfo(`[sqlite] using ${dbPath}`);
		return dbPath;
	});
}
