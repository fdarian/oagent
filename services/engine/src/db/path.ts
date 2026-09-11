import { Config, Effect, Option } from 'effect';
import type { ConfigError } from 'effect/Config';
import { FileSystem } from 'effect/FileSystem';
import { Path } from 'effect/Path';
import type { PlatformError } from 'effect/PlatformError';
import { getOagentBaseDir } from '../paths.ts';

export function resolveDbPath(): Effect.Effect<
	string,
	ConfigError | PlatformError,
	FileSystem | Path
> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;

		const pathFromEnv = Option.getOrNull(
			yield* Config.String('OAGENT_DB_PATH').pipe(Config.option),
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
