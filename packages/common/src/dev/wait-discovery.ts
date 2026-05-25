import { FileSystem } from '@effect/platform/FileSystem';
import { Effect, pipe, Schedule } from 'effect';

export const waitForDiscovery = <T>(
	filePath: string,
	opts: { parse: (raw: string) => T },
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		return yield* pipe(
			fs.readFileString(filePath),
			Effect.map(opts.parse),
			Effect.retry(Schedule.spaced('250 millis')),
		);
	});
