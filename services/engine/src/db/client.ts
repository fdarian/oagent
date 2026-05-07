/// <reference types="bun" />
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import * as schema from './schema.ts';
import { resolveDbPath } from './path.ts';
import { runMigrations } from './migrate.ts';

class DbOpenError extends Schema.TaggedError<DbOpenError>()('DbOpenError', {
  cause: Schema.Defect,
  path: Schema.String,
}) {}

const recoverOrphanedRunningJobs = (db: ReturnType<typeof drizzle>) =>
  Effect.try({
    try: () => {
      db.run(
        sql`UPDATE jobs SET status = 'error', error_message = 'engine restarted while running', terminated_at = ${Date.now()} WHERE status = 'running'`,
      );
    },
    catch: (cause) => new DbOpenError({ cause, path: 'recover' }),
  });

export class Db extends Effect.Service<Db>()('oagent/Db', {
  scoped: Effect.gen(function* () {
    const dbPath = yield* Effect.sync(resolveDbPath);
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
    yield* recoverOrphanedRunningJobs(db);
    return { db, sqlite } as const;
  }),
}) {}
