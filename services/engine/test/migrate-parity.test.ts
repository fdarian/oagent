import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { type Column, getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { Effect } from 'effect';
import bundle from '../.gen/migrations.gen.ts';
import journal from '../drizzle/meta/_journal.json' with { type: 'json' };
import { Db } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import * as schema from '../src/db/schema.ts';
import { testDbLayer } from './helpers/db.ts';

type PragmaColumn = {
	name: string;
	type: string;
	notnull: number;
	pk: number;
};

type SchemaSnapshot = Record<string, PragmaColumn[]>;

type PragmaTableInfoRow = {
	cid: number;
	name: string;
	type: string;
	notnull: number;
	dflt_value: unknown;
	pk: number;
};

type SqliteMasterRow = {
	name: string;
};

type DrizzleMigrationRow = {
	hash: string;
	created_at: number;
};

type SqliteClient = {
	query: <T, _P extends unknown[]>(sql: string) => { all: () => T[] };
};

/** Every application table declared in `schema.ts`. */
const schemaTables: Record<string, SQLiteTable> = {
	jobs: schema.jobs,
	events: schema.events,
	chunk_events: schema.chunkEvents,
	tool_call_events: schema.toolCallEvents,
	plan_events: schema.planEvents,
	available_commands_events: schema.availableCommandsEvents,
	current_mode_events: schema.currentModeEvents,
	config_option_events: schema.configOptionEvents,
	session_info_events: schema.sessionInfoEvents,
	usage_events: schema.usageEvents,
	model_aliases: schema.modelAliases,
};

const drizzleDir = path.join(import.meta.dirname, '../drizzle');

const expectedSqliteType = (columnType: string): string => {
	switch (columnType) {
		case 'SQLiteInteger':
		case 'SQLiteTimestamp':
			return 'INTEGER';
		case 'SQLiteText':
		case 'SQLiteTextJson':
			return 'TEXT';
		case 'SQLiteReal':
			return 'REAL';
		default:
			throw new Error(`Unhandled column type: ${columnType}`);
	}
};

const readPragmaColumns = (
	sqlite: SqliteClient,
	table: string,
): PragmaColumn[] =>
	sqlite.query<PragmaTableInfoRow, []>(`PRAGMA table_info('${table}')`).all();

const snapshotAppSchema = (sqlite: SqliteClient): SchemaSnapshot => {
	const snapshot: SchemaSnapshot = {};
	for (const table of Object.keys(schemaTables)) {
		snapshot[table] = readPragmaColumns(sqlite, table);
	}
	return snapshot;
};

const assertTablesMatchSchema = (sqlite: SqliteClient) => {
	const tables = sqlite
		.query<SqliteMasterRow, []>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		.all();

	expect(tables.map((t) => t.name).sort()).toEqual(
		['__drizzle_migrations', ...Object.keys(schemaTables)].sort(),
	);

	for (const [tableName, table] of Object.entries(schemaTables)) {
		const expected: Column[] = Object.values(getTableColumns(table));
		const actual = readPragmaColumns(sqlite, tableName);

		// SQLite PRAGMA column order follows migration history (e.g. ALTER ADD
		// appends); Drizzle definition order can differ — compare names as a set.
		expect(actual.map((c) => c.name).sort()).toEqual(
			expected.map((c) => c.name).sort(),
		);

		for (const col of expected) {
			const row = actual.find((c) => c.name === col.name);
			expect(row, `missing column ${tableName}.${col.name}`).toBeDefined();
			if (row === undefined) continue;

			expect(row.type.toUpperCase()).toBe(expectedSqliteType(col.columnType));
			expect(row.notnull).toBe(col.notNull ? 1 : 0);
			expect(row.pk).toBe(col.primary ? 1 : 0);
		}
	}
};

const expectedEmbeddedMigrations = () =>
	bundle.journal.entries.map((entry) => {
		const raw = bundle.files[entry.tag];
		if (raw === undefined) {
			throw new Error(`Missing embedded SQL for ${entry.tag}`);
		}
		return {
			hash: crypto.createHash('sha256').update(raw).digest('hex'),
			created_at: entry.when,
		};
	});

const readAppliedMigrations = (sqlite: SqliteClient) =>
	sqlite
		.query<DrizzleMigrationRow, []>(
			'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at',
		)
		.all();

describe('migration parity', () => {
	it.effect('embedded migrations produce the Drizzle schema', () =>
		Effect.gen(function* () {
			const { sqlite } = yield* Db;
			assertTablesMatchSchema(sqlite);
		}).pipe(Effect.provide(testDbLayer)),
	);

	it.effect('runMigrations is idempotent on an already-migrated database', () =>
		Effect.gen(function* () {
			const { db, sqlite } = yield* Db;
			const before = snapshotAppSchema(sqlite);
			const journalBefore = readAppliedMigrations(sqlite);

			yield* runMigrations(db);

			expect(snapshotAppSchema(sqlite)).toEqual(before);
			expect(readAppliedMigrations(sqlite)).toEqual(journalBefore);
			assertTablesMatchSchema(sqlite);
		}).pipe(Effect.provide(testDbLayer)),
	);

	it.effect('embedded bundle stays aligned with drizzle SQL on disk', () =>
		Effect.gen(function* () {
			const { sqlite } = yield* Db;

			expect(bundle.journal.entries).toEqual(journal.entries);

			for (const entry of journal.entries) {
				const onDisk = fs.readFileSync(
					path.join(drizzleDir, `${entry.tag}.sql`),
					'utf-8',
				);
				expect(bundle.files[entry.tag]).toBe(onDisk);
			}

			expect(readAppliedMigrations(sqlite)).toEqual(
				expectedEmbeddedMigrations(),
			);
		}).pipe(Effect.provide(testDbLayer)),
	);
});
