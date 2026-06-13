import fs from 'node:fs';
import path from 'node:path';
import { Config, type ConfigError, Effect, Option } from 'effect';
import { getOagentBaseDir } from '../paths.ts';

export function resolveDbPath(): Effect.Effect<
	string,
	ConfigError.ConfigError
> {
	return Effect.gen(function* () {
		const pathFromEnv = Option.getOrNull(
			yield* Config.string('OAGENT_DB_PATH').pipe(Config.option),
		);
		if (pathFromEnv) {
			const resolved = path.resolve(pathFromEnv);
			fs.mkdirSync(path.dirname(resolved), { recursive: true });
			yield* Effect.logInfo(`[sqlite] using ${pathFromEnv}`);
			return resolved;
		}

		const baseDir = getOagentBaseDir();
		fs.mkdirSync(baseDir, { recursive: true });
		const dbPath = path.join(baseDir, 'sqlite.db');
		yield* Effect.logInfo(`[sqlite] using ${dbPath}`);
		return dbPath;
	});
}
