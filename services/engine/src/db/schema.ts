import type {
	AvailableCommand,
	ContentBlock,
	PlanEntry,
	SessionConfigOption,
	ToolCallContent,
	ToolCallLocation,
} from '@agentclientprotocol/sdk';
import { sql } from 'drizzle-orm';
import {
	type AnySQLiteColumn,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable(
	'sessions',
	{
		id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
		uuid: text().notNull(),
		backend: text().notNull(),
		harness_session_id: text(),
		cwd: text().notNull(),
		worktree_path: text(),
		worktree_branch: text(),
		mcp_session_id: text(),
		forked_from_job_id: integer({ mode: 'number' }).references(
			(): AnySQLiteColumn => jobs.id,
		),
		created_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [uniqueIndex('sessions_uuid_uq').on(table.uuid)],
);

export const jobs = sqliteTable(
	'jobs',
	{
		id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
		uuid: text().notNull(),
		status: text({ enum: ['running', 'done', 'error', 'cancelled'] }).notNull(),
		prompt: text().notNull(),
		model: text(),
		agent_type: text(),
		created_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		terminated_at: integer({ mode: 'timestamp_ms' }),
		session_id: integer({ mode: 'number' })
			.notNull()
			.references(() => sessions.id),
		harness_last_message_id: text(),
		text: text(),
		stop_reason: text(),
		error_message: text(),
		side_chat_id: integer({ mode: 'number' }).references(
			(): AnySQLiteColumn => sideChats.id,
			{ onDelete: 'cascade' },
		),
	},
	(table) => [
		uniqueIndex('jobs_uuid_uq').on(table.uuid),
		index('jobs_status_created_at_idx').on(table.status, table.created_at),
		index('jobs_side_chat_created_at_idx').on(
			table.side_chat_id,
			table.created_at,
		),
		uniqueIndex('jobs_side_chat_running_uq')
			.on(table.side_chat_id)
			.where(sql`${table.status} = 'running'`),
		uniqueIndex('jobs_session_running_uq')
			.on(table.session_id)
			.where(sql`${table.status} = 'running'`),
	],
);

export const sideChats = sqliteTable(
	'side_chats',
	{
		id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
		uuid: text().notNull(),
		source_job_id: integer({ mode: 'number' })
			.notNull()
			.references((): AnySQLiteColumn => jobs.id, { onDelete: 'cascade' }),
		session_id: text(),
		first_turn_dispatched_at: integer({ mode: 'timestamp_ms' }),
		created_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [
		uniqueIndex('side_chats_uuid_uq').on(table.uuid),
		index('side_chats_source_job_created_at_idx').on(
			table.source_job_id,
			table.created_at,
		),
	],
);

export const events = sqliteTable(
	'events',
	{
		id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
		job_id: integer({ mode: 'number' })
			.notNull()
			.references(() => jobs.id, { onDelete: 'cascade' }),
		created_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		type: text({
			enum: [
				'user_message_chunk',
				'agent_message_chunk',
				'agent_thought_chunk',
				'tool_call',
				'tool_call_update',
				'plan',
				'available_commands_update',
				'current_mode_update',
				'config_option_update',
				'session_info_update',
				'usage_update',
				'cursor_extension',
			],
		}).notNull(),
		meta: text({ mode: 'json' }).$type<Record<string, unknown> | null>(),
	},
	(table) => [
		index('events_job_created_at_id_idx').on(
			table.job_id,
			table.created_at,
			table.id,
		),
	],
);

export const chunkEvents = sqliteTable('chunk_events', {
	event_id: integer({ mode: 'number' })
		.primaryKey()
		.references(() => events.id, { onDelete: 'cascade' }),
	message_id: text(),
	content: text({ mode: 'json' }).$type<ContentBlock>().notNull(),
});

export const toolCallEvents = sqliteTable('tool_call_events', {
	event_id: integer({ mode: 'number' })
		.primaryKey()
		.references(() => events.id, { onDelete: 'cascade' }),
	tool_call_id: text().notNull(),
	title: text(),
	status: text({ enum: ['pending', 'in_progress', 'completed', 'failed'] }),
	kind: text({
		enum: [
			'read',
			'edit',
			'delete',
			'move',
			'search',
			'execute',
			'think',
			'fetch',
			'switch_mode',
			'other',
		],
	}),
	content: text({ mode: 'json' }).$type<ToolCallContent[] | null>(),
	locations: text({ mode: 'json' }).$type<ToolCallLocation[] | null>(),
	raw_input: text({ mode: 'json' }).$type<unknown>(),
	raw_output: text({ mode: 'json' }).$type<unknown>(),
});

export const planEvents = sqliteTable('plan_events', {
	event_id: integer({ mode: 'number' })
		.primaryKey()
		.references(() => events.id, { onDelete: 'cascade' }),
	entries: text({ mode: 'json' }).$type<PlanEntry[]>().notNull(),
});

export const availableCommandsEvents = sqliteTable(
	'available_commands_events',
	{
		event_id: integer({ mode: 'number' })
			.primaryKey()
			.references(() => events.id, { onDelete: 'cascade' }),
		available_commands: text({ mode: 'json' })
			.$type<AvailableCommand[]>()
			.notNull(),
	},
);

export const currentModeEvents = sqliteTable('current_mode_events', {
	event_id: integer({ mode: 'number' })
		.primaryKey()
		.references(() => events.id, { onDelete: 'cascade' }),
	current_mode_id: text().notNull(),
});

export const configOptionEvents = sqliteTable('config_option_events', {
	event_id: integer({ mode: 'number' })
		.primaryKey()
		.references(() => events.id, { onDelete: 'cascade' }),
	config_options: text({ mode: 'json' })
		.$type<SessionConfigOption[]>()
		.notNull(),
});

export const sessionInfoEvents = sqliteTable('session_info_events', {
	event_id: integer({ mode: 'number' })
		.primaryKey()
		.references(() => events.id, { onDelete: 'cascade' }),
	title: text(),
	updated_at: text(),
});

export const usageEvents = sqliteTable('usage_events', {
	event_id: integer({ mode: 'number' })
		.primaryKey()
		.references(() => events.id, { onDelete: 'cascade' }),
	size: integer({ mode: 'number' }).notNull(),
	used: integer({ mode: 'number' }).notNull(),
	cost_amount: real(),
	cost_currency: text(),
});

export const modelAliases = sqliteTable(
	'model_aliases',
	{
		id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
		name: text().notNull(),
		backend: text().notNull(),
		model_id: text().notNull(),
		reasoning_effort: text(),
		description: text(),
		created_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		updated_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [uniqueIndex('model_aliases_name_uq').on(table.name)],
);

export const agents = sqliteTable(
	'agents',
	{
		id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
		name: text().notNull(),
		description: text(),
		created_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		updated_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [uniqueIndex('agents_name_uq').on(table.name)],
);

export const agentHarnessTargets = sqliteTable(
	'agent_harness_targets',
	{
		id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
		agent_id: integer({ mode: 'number' })
			.notNull()
			.references(() => agents.id, { onDelete: 'cascade' }),
		backend: text().notNull(),
		target: text().notNull(),
		created_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		updated_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [
		uniqueIndex('agent_harness_targets_agent_id_backend_uq').on(
			table.agent_id,
			table.backend,
		),
	],
);

export const settings = sqliteTable(
	'settings',
	{
		id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
		key: text().notNull(),
		value: text().notNull(),
		created_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		updated_at: integer({ mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [uniqueIndex('settings_key_uq').on(table.key)],
);

export const harnesses = sqliteTable('harnesses', {
	backend: text().primaryKey(),
	binary_path: text().notNull(),
	version: text(),
	detected_at: integer({ mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date()),
});
