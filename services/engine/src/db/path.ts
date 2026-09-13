import { Effect } from 'effect';
import type { ConfigError } from 'effect/Config';
import { FileSystem } from 'effect/FileSystem';
import { Path } from 'effect/Path';
import type { PlatformError } from 'effect/PlatformError';
import { getOagentDbPath } from '../paths.ts';

export function resolveDbPath(): Effect.Effect<
	string,
	ConfigError | PlatformError,
	FileSystem | Path
> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const dbPath = yield* getOagentDbPath;
		yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });
		yield* Effect.logInfo(`[sqlite] using ${dbPath}`);
		return dbPath;
	});
}
