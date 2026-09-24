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
			// Drizzle wraps every migration in a transaction, where PRAGMA foreign_keys=OFF
			// cannot take effect. Rebuilding jobs with it enabled cascades deletes to events.
			db.run(sql`PRAGMA foreign_keys=OFF`);
			try {
				// biome-ignore lint/suspicious/noExplicitAny: internal drizzle API
				(db as any).dialect.migrate(migrations, (db as any).session);
				const violations = db.values(sql`PRAGMA foreign_key_check`);
				if (violations.length > 0) {
					throw new Error(
						`Migration broke foreign keys: ${JSON.stringify(violations)}`,
					);
				}
			} finally {
				db.run(sql`PRAGMA foreign_keys=ON`);
			}
		},
		catch: (cause) => new MigrationError({ cause }),
	});
