/// <reference types="bun" />
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Context, Effect, Layer, Schema } from 'effect';
import { runMigrations } from './migrate.ts';
import { resolveDbPath } from './path.ts';
import * as schema from './schema.ts';

class DbOpenError extends Schema.TaggedError<DbOpenError>()('DbOpenError', {
	cause: Schema.Defect(),
	path: Schema.String,
}) {}

export class Db extends Context.Service<Db>()('oagent/Db', {
	make: Effect.gen(function* () {
		const dbPath = yield* resolveDbPath();
		const sqlite = yield* Effect.acquireRelease(
			Effect.try({
				try: () => {
					const s = new Database(dbPath);
					s.exec('PRAGMA journal_mode = WAL;');
					s.exec('PRAGMA synchronous = NORMAL;');
					s.exec('PRAGMA foreign_keys = ON;');
					s.exec('PRAGMA busy_timeout = 5000;');
					return s;
				},
				catch: (cause) => new DbOpenError({ cause, path: dbPath }),
			}),
			(s) => Effect.sync(() => s.close()),
		);
		const db = drizzle(sqlite, { schema });
		yield* runMigrations(db);
		return { db, sqlite } as const;
	}),
}) {
	static readonly layer = Layer.effect(Db, Db.make);
}
