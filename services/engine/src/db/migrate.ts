import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { Effect, Schema } from 'effect';
import bundle from '../../.gen/migrations.gen.ts';

class MigrationError extends Schema.TaggedError<MigrationError>()(
	'MigrationError',
	{
		cause: Schema.Defect(),
	},
) {}

export const runMigrations = (db: BunSQLiteDatabase<Record<string, unknown>>) =>
	Effect.try({
		try: () => {
			const migrations = bundle.journal.entries.map(
				(e: {
					idx: number;
					when: number;
					tag: string;
					breakpoints: boolean;
				}) => {
					const raw = bundle.files[e.tag];
					if (raw === undefined)
						throw new Error(`Missing embedded SQL for ${e.tag}`);
					return {
						sql: raw.split('--> statement-breakpoint'),
						bps: e.breakpoints,
						folderMillis: e.when,
						hash: crypto.createHash('sha256').update(raw).digest('hex'),
					};
				},
			);
			db.run(
				sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
			);
			const last = db.values(
				sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
			)[0];
			const pending = migrations.filter(
				(migration) =>
					last === undefined || Number(last[0]) < migration.folderMillis,
			);
			if (pending.length === 0) return;

			// SQLite cannot change foreign_keys inside a transaction; rebuilding jobs
			// with it enabled would cascade deletes into its event tables.
			db.run(sql`PRAGMA foreign_keys=OFF`);
			try {
				for (const migration of pending) {
					db.run(sql`BEGIN`);
					try {
						for (const statement of migration.sql) {
							db.run(sql.raw(statement));
						}
						const violations = db.values(sql`PRAGMA foreign_key_check`);
						if (violations.length > 0) {
							throw new Error(
								`Migration broke foreign keys: ${JSON.stringify(violations)}`,
							);
						}
						db.run(
							sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`,
						);
						db.run(sql`COMMIT`);
					} catch (cause) {
						db.run(sql`ROLLBACK`);
						throw cause;
					}
				}
			} finally {
				db.run(sql`PRAGMA foreign_keys=ON`);
			}
		},
		catch: (cause) => new MigrationError({ cause }),
	});
