import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './db/schema.ts';

const TEST_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE sessions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	uuid TEXT NOT NULL UNIQUE,
	title TEXT NOT NULL,
	backend TEXT NOT NULL,
	harness_session_id TEXT,
	cwd TEXT NOT NULL,
	worktree_path TEXT,
	worktree_branch TEXT,
	forked_from_job_id INTEGER REFERENCES jobs(id),
	created_at INTEGER NOT NULL
);

CREATE TABLE side_chats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	uuid TEXT NOT NULL UNIQUE,
	source_job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
	session_id TEXT,
	first_turn_dispatched_at INTEGER,
	created_at INTEGER NOT NULL
);

CREATE TABLE jobs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	uuid TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL,
	prompt TEXT NOT NULL,
	model TEXT,
	reasoning_effort TEXT,
	agent_type TEXT,
	created_at INTEGER NOT NULL,
	terminated_at INTEGER,
	session_id INTEGER NOT NULL REFERENCES sessions(id),
	harness_last_message_id TEXT,
	text TEXT,
	stop_reason TEXT,
	error_message TEXT,
	side_chat_id INTEGER REFERENCES side_chats(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX jobs_side_chat_running_uq
	ON jobs (side_chat_id) WHERE status = 'running';
CREATE UNIQUE INDEX jobs_session_running_uq
	ON jobs (session_id) WHERE status = 'running';

CREATE TABLE events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL,
	type TEXT NOT NULL,
	meta TEXT
);
CREATE TABLE chunk_events (
	event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
	message_id TEXT,
	content TEXT NOT NULL
);
CREATE TABLE tool_call_events (
	event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
	tool_call_id TEXT NOT NULL,
	title TEXT,
	status TEXT,
	kind TEXT,
	content TEXT,
	locations TEXT,
	raw_input TEXT,
	raw_output TEXT
);
CREATE TABLE plan_events (
	event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
	entries TEXT NOT NULL
);
CREATE TABLE available_commands_events (
	event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
	available_commands TEXT NOT NULL
);
CREATE TABLE current_mode_events (
	event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
	current_mode_id TEXT NOT NULL
);
CREATE TABLE config_option_events (
	event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
	config_options TEXT NOT NULL
);
CREATE TABLE session_info_events (
	event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
	title TEXT,
	updated_at TEXT
);
CREATE TABLE usage_events (
	event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
	size INTEGER NOT NULL,
	used INTEGER NOT NULL,
	cost_amount REAL,
	cost_currency TEXT
);

CREATE TABLE model_aliases (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	backend TEXT NOT NULL,
	model_id TEXT NOT NULL,
	reasoning_effort TEXT,
	description TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
`;

export function createTestDatabase(databasePath = ':memory:') {
	const sqlite = new Database(databasePath);
	sqlite.exec(TEST_SCHEMA);
	return { sqlite, db: drizzle(sqlite, { schema }) };
}

export function connectTestDatabase(databasePath: string) {
	const sqlite = new Database(databasePath);
	sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
	return { sqlite, db: drizzle(sqlite, { schema }) };
}
