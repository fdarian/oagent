import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Config, type ConfigError, Effect, Option } from 'effect';

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

		const dir = path.join(os.homedir(), '.config', 'oagent');
		fs.mkdirSync(dir, { recursive: true });
		const dbPath = path.join(dir, 'sqlite.db');
		yield* Effect.logInfo(`[sqlite] using ${dbPath}`);
		return dbPath;
	});
}
