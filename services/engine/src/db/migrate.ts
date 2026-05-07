import crypto from 'node:crypto';
import { Effect, Schema } from 'effect';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import bundle from '../../.gen/migrations.gen.ts';

class MigrationError extends Schema.TaggedError<MigrationError>()('MigrationError', {
  cause: Schema.Defect,
}) {}

export const runMigrations = (db: BunSQLiteDatabase<Record<string, unknown>>) =>
  Effect.try({
    try: () => {
      const migrations = bundle.journal.entries.map((e: { idx: number; when: number; tag: string; breakpoints: boolean }) => {
        const raw = bundle.files[e.tag];
        if (raw === undefined) throw new Error(`Missing embedded SQL for ${e.tag}`);
        return {
          sql: raw.split('--> statement-breakpoint'),
          bps: e.breakpoints,
          folderMillis: e.when,
          hash: crypto.createHash('sha256').update(raw).digest('hex'),
        };
      });
      // biome-ignore lint/suspicious/noExplicitAny: internal drizzle API
      (db as any).dialect.migrate(migrations, (db as any).session);
    },
    catch: (cause) => new MigrationError({ cause }),
  });
