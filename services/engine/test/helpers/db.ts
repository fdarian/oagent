import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Db } from '../../src/db/client.ts';

/**
 * Scoped layer: isolated SQLite file under the OS tmpdir (never ~/.config/oagent).
 * Runs migrations + orphan recovery via `Db` acquire. Deletes the db (+ WAL/SHM) on release.
 *
 * Production path is unchanged; tests rely on `OAGENT_DB_PATH` (see `src/db/path.ts`).
 */
export const testDbLayer = Layer.unwrapScoped(
	Effect.gen(function* () {
		const dbPath = path.join(os.tmpdir(), `oagent-test-${randomUUID()}.db`);
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });

		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				for (const suffix of ['', '-wal', '-shm']) {
					try {
						fs.unlinkSync(`${dbPath}${suffix}`);
					} catch {
						// already removed or never created
					}
				}
			}),
		);

		return Layer.setConfigProvider(
			ConfigProvider.fromMap(new Map([['OAGENT_DB_PATH', dbPath]])),
		).pipe(Layer.provideMerge(Db.Default));
	}),
);
