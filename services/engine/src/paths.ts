import os from 'node:os';
import type { PlatformError } from '@effect/platform/Error';
import { FileSystem } from '@effect/platform/FileSystem';
import { Path } from '@effect/platform/Path';
import { Effect } from 'effect';

export const getOagentBaseDir: Effect.Effect<string, never, Path> = Effect.gen(
	function* () {
		const path = yield* Path;
		return path.join(os.homedir(), '.config', 'oagent');
	},
);

export const getOagentLogsDir: Effect.Effect<string, never, Path> = Effect.gen(
	function* () {
		const path = yield* Path;
		const baseDir = yield* getOagentBaseDir;
		return path.join(baseDir, 'logs');
	},
);

export const ensureOagentLogsDir: Effect.Effect<
	string,
	PlatformError,
	FileSystem | Path
> = Effect.gen(function* () {
	const fs = yield* FileSystem;
	const logsDir = yield* getOagentLogsDir;
	yield* fs.makeDirectory(logsDir, { recursive: true });
	return logsDir;
});
