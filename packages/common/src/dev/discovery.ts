import { FileSystem } from '@effect/platform/FileSystem';
import { Path } from '@effect/platform/Path';
import { Effect } from 'effect';

export const discoveryFile = (filePath: string, value: unknown) =>
	Effect.acquireRelease(
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const path = yield* Path;
			yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
			yield* fs.writeFileString(filePath, JSON.stringify(value));
		}),
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem;
				yield* fs.remove(filePath).pipe(Effect.catchAll(() => Effect.void));
			}),
	);
