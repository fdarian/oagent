import crypto from 'node:crypto';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { sql } from 'drizzle-orm';
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
			db.run(sql.raw(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (\n\t\tid INTEGER PRIMARY KEY AUTOINCREMENT,\n\t\thash text NOT NULL,\n\t\tcreated_at numeric\n\t)`));
			const rows = db.all<{ created_at: number | string }>(
				sql.raw('SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1'),
			);
			const lastMigration = rows[0];
			db.run(sql.raw('BEGIN'));
			try {
				for (const migration of migrations) {
					if (lastMigration === undefined || Number(lastMigration.created_at) < migration.folderMillis) {
						for (const statement of migration.sql) {
							db.run(sql.raw(statement));
						}
						db.run(sql.raw(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES ('${migration.hash}', ${migration.folderMillis})`));
					}
				}
				db.run(sql.raw('COMMIT'));
			} catch (cause) {
				db.run(sql.raw('ROLLBACK'));
				throw cause;
			}
		},
		catch: (cause) => new MigrationError({ cause }),
	});
