import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Effect } from 'effect';
import bundle from '../../.gen/migrations.gen.ts';
import { runMigrations } from './migrate.ts';

test('backfills legacy jobs into sessions without losing side chats or events', () => {
	const directory = mkdtempSync(join(tmpdir(), 'oagent-migration-'));
	const originalPath = join(directory, 'before.sqlite');
	const copyPath = join(directory, 'copy.sqlite');
	try {
		const original = new Database(originalPath);
		const previousMigrations = bundle.journal.entries.filter(
			(entry) => entry.idx <= 12,
		);
		for (const migration of previousMigrations) {
			const sql = bundle.files[migration.tag];
			if (sql === undefined) throw new Error(`Missing ${migration.tag}`);
			original.exec(sql);
		}
		const previous = previousMigrations.at(-1);
		if (previous === undefined) throw new Error('Missing previous migration');
		original.exec(`
			CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
			INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('previous', ${previous.when});
			PRAGMA foreign_keys=ON;
			INSERT INTO jobs (id, uuid, status, prompt, cwd, backend, session_id, mcp_session_id, created_at, worktree_path, worktree_branch, model, text)
			VALUES
				(1, 'job-first-inserted', 'done', 'later shared turn', '/later', 'opencode', 'ses_shared', 'mcp-later', 2000, NULL, NULL, 'model', 'later text'),
				(2, 'job-earliest', 'done', 'earliest shared turn', '/earliest', 'opencode', 'ses_shared', 'mcp-first', 1000, '/tree', 'branch', 'model', 'first text'),
				(3, 'job-null', 'done', 'null harness session', '/null', 'cursor', NULL, NULL, 3000, NULL, NULL, 'auto', 'null text'),
				(4, 'job-other', 'running', 'other harness session', '/other', 'opencode', 'ses_other', NULL, 4000, NULL, NULL, 'model', NULL);
			INSERT INTO side_chats (id, uuid, source_job_id, created_at) VALUES (1, 'side-chat', 1, 5000);
			INSERT INTO jobs (id, uuid, status, prompt, cwd, backend, session_id, side_chat_id, created_at, model, text)
			VALUES (5, 'job-child', 'done', 'side chat turn', '/child', 'opencode', 'ses_child', 1, 6000, 'model', 'child text');
			INSERT INTO events (id, job_id, type, created_at) VALUES (1, 1, 'agent_message_chunk', 2100), (2, 5, 'agent_message_chunk', 6100);
			INSERT INTO chunk_events (event_id, content) VALUES (1, '{"type":"text","text":"later text"}'), (2, '{"type":"text","text":"child text"}');
		`);
		original.close();
		copyFileSync(originalPath, copyPath);

		const migrated = new Database(copyPath);
		try {
			migrated.exec('PRAGMA foreign_keys=ON;');
			Effect.runSync(runMigrations(drizzle(migrated)));
			expect(migrated.query('PRAGMA foreign_keys').get()).toEqual({
				foreign_keys: 1,
			});
			expect(migrated.query('PRAGMA foreign_key_check').all()).toEqual([]);
			expect(
				migrated.query('SELECT count(*) AS count FROM sessions').get(),
			).toEqual({ count: 4 });
			expect(
				migrated.query('SELECT count(*) AS count FROM jobs').get(),
			).toEqual({ count: 5 });
			expect(
				migrated.query('SELECT count(*) AS count FROM side_chats').get(),
			).toEqual({ count: 1 });
			expect(
				migrated.query('SELECT count(*) AS count FROM events').get(),
			).toEqual({ count: 2 });
			expect(
				migrated.query('SELECT count(*) AS count FROM chunk_events').get(),
			).toEqual({ count: 2 });

			const sessions = migrated
				.query(
					'SELECT uuid, title, backend, harness_session_id, cwd, worktree_path, worktree_branch, created_at FROM sessions ORDER BY created_at',
				)
				.all();
			expect(
				migrated.query('PRAGMA table_info(sessions)').all(),
			).not.toContainEqual(expect.objectContaining({ name: 'mcp_session_id' }));
			expect(sessions).toMatchObject([
				{
					title: 'later shared turn',
					backend: 'opencode',
					harness_session_id: 'ses_shared',
					cwd: '/earliest',
					worktree_path: '/tree',
					worktree_branch: 'branch',
					created_at: 1000,
				},
				{
					title: 'null harness session',
					backend: 'cursor',
					harness_session_id: null,
					cwd: '/null',
					created_at: 3000,
				},
				{
					title: 'other harness session',
					backend: 'opencode',
					harness_session_id: 'ses_other',
					cwd: '/other',
					created_at: 4000,
				},
				{
					title: 'side chat turn',
					backend: 'opencode',
					harness_session_id: 'ses_child',
					cwd: '/child',
					created_at: 6000,
				},
			]);
			for (const session of sessions) {
				if (
					session === null ||
					typeof session !== 'object' ||
					!('uuid' in session)
				)
					throw new Error('Expected session UUID');
				expect(session.uuid).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
				);
			}
			const jobs = migrated
				.query(
					'SELECT j.id, j.uuid, j.status, j.text, j.side_chat_id, s.title AS session_title, s.harness_session_id FROM jobs j JOIN sessions s ON s.id = j.session_id ORDER BY j.id',
				)
				.all();
			expect(jobs).toEqual([
				{
					id: 1,
					uuid: 'job-first-inserted',
					status: 'done',
					text: 'later text',
					side_chat_id: null,
					session_title: 'later shared turn',
					harness_session_id: 'ses_shared',
				},
				{
					id: 2,
					uuid: 'job-earliest',
					status: 'done',
					text: 'first text',
					side_chat_id: null,
					session_title: 'later shared turn',
					harness_session_id: 'ses_shared',
				},
				{
					id: 3,
					uuid: 'job-null',
					status: 'done',
					text: 'null text',
					side_chat_id: null,
					session_title: 'null harness session',
					harness_session_id: null,
				},
				{
					id: 4,
					uuid: 'job-other',
					status: 'error',
					text: null,
					side_chat_id: null,
					session_title: 'other harness session',
					harness_session_id: 'ses_other',
				},
				{
					id: 5,
					uuid: 'job-child',
					status: 'done',
					text: 'child text',
					side_chat_id: 1,
					session_title: 'side chat turn',
					harness_session_id: 'ses_child',
				},
			]);
			expect(
				migrated
					.query(
						'SELECT e.job_id, c.content FROM events e JOIN chunk_events c ON c.event_id = e.id ORDER BY e.id',
					)
					.all(),
			).toEqual([
				{ job_id: 1, content: '{"type":"text","text":"later text"}' },
				{ job_id: 5, content: '{"type":"text","text":"child text"}' },
			]);
		} finally {
			migrated.close();
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('backfills session titles from the lowest job id and names empty sessions', () => {
	const sqlite = new Database(':memory:');
	try {
		const latest = bundle.journal.entries.at(-1);
		if (latest === undefined) throw new Error('Missing latest migration');
		const previousMigrations = bundle.journal.entries.filter(
			(entry) => entry.idx < latest.idx,
		);
		for (const migration of previousMigrations) {
			const migrationSql = bundle.files[migration.tag];
			if (migrationSql === undefined)
				throw new Error(`Missing ${migration.tag}`);
			sqlite.exec(migrationSql);
		}
		const previous = previousMigrations.at(-1);
		if (previous === undefined) throw new Error('Missing previous migration');
		sqlite.exec(`
			CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
			INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('previous', ${previous.when});
			PRAGMA foreign_keys=ON;
			INSERT INTO sessions (id, uuid, backend, cwd, created_at)
			VALUES (1, 'existing-session', 'opencode', '/repo', 100),
				(2, 'empty-session', 'codex', '/empty', 200),
				(3, 'blank-first-line-session', 'opencode', '/blank', 300);
			INSERT INTO jobs (id, uuid, status, prompt, created_at, session_id)
			VALUES
				(1, 'first-job', 'done', char(9) || '  First title line  ' || char(13) || char(10) || 'Rest of prompt', 100, 1),
				(2, 'second-job', 'done', 'Later job title', 50, 1),
				(3, 'blank-first-line-job', 'done', '  ' || char(9) || char(10) || 'Later non-empty line', 300, 3);
		`);

		Effect.runSync(runMigrations(drizzle(sqlite)));

		expect(
			sqlite.query('SELECT uuid, title FROM sessions ORDER BY id').all(),
		).toEqual([
			{ uuid: 'existing-session', title: 'First title line' },
			{ uuid: 'empty-session', title: 'Untitled' },
			{ uuid: 'blank-first-line-session', title: 'Untitled' },
		]);
		expect(sqlite.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally {
		sqlite.close();
	}
});

test('checks foreign keys before committing a migration, but skips checks on an up-to-date database', () => {
	const sqlite = new Database(':memory:');
	try {
		const previousMigrations = bundle.journal.entries.filter(
			(entry) => entry.idx <= 12,
		);
		for (const migration of previousMigrations) {
			const migrationSql = bundle.files[migration.tag];
			if (migrationSql === undefined)
				throw new Error(`Missing ${migration.tag}`);
			sqlite.exec(migrationSql);
		}
		const previous = previousMigrations.at(-1);
		if (previous === undefined) throw new Error('Missing previous migration');
		sqlite.exec(
			`CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric); INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('previous', ${previous.when});`,
		);
		// A legacy orphan must prevent the new migration from being recorded.
		sqlite.exec(
			"INSERT INTO events (id, job_id, type, created_at) VALUES (1, 999, 'agent_message_chunk', 1)",
		);
		expect(() => Effect.runSync(runMigrations(drizzle(sqlite)))).toThrow();
		expect(
			sqlite.query('SELECT count(*) AS count FROM __drizzle_migrations').get(),
		).toEqual({ count: 1 });
		expect(
			sqlite
				.query(
					"SELECT count(*) AS count FROM sqlite_master WHERE name = 'sessions'",
				)
				.get(),
		).toEqual({ count: 0 });
		sqlite.exec('DELETE FROM events WHERE id = 1');
		Effect.runSync(runMigrations(drizzle(sqlite)));
		expect(
			sqlite.query('SELECT count(*) AS count FROM __drizzle_migrations').get(),
		).toEqual({
			count: 1 + bundle.journal.entries.length - previousMigrations.length,
		});
		sqlite.exec(
			"PRAGMA foreign_keys=OFF; INSERT INTO events (id, job_id, type, created_at) VALUES (1, 999, 'agent_message_chunk', 1); PRAGMA foreign_keys=ON;",
		);
		Effect.runSync(runMigrations(drizzle(sqlite)));
		expect(sqlite.query('PRAGMA foreign_key_check').all()).toHaveLength(1);
	} finally {
		sqlite.close();
	}
});
