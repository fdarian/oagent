import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { and, eq, gt } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { assembleEvent } from './assembleEvent.ts';
import * as schema from './schema.ts';

export type SessionEventPage = {
	events: { event: SessionUpdate; sequence: number }[];
	nextCursor: number | null;
};

export const insertSessionUpdate = (
	db: BunSQLiteDatabase<typeof schema>,
	jobId: number,
	event: SessionUpdate,
): number => {
	return db.transaction((tx) => {
		const meta =
			'_meta' in event && event._meta !== undefined && event._meta !== null
				? (event._meta as Record<string, unknown>)
				: null;

		const eventRow = tx
			.insert(schema.events)
			.values({
				job_id: jobId,
				type: event.sessionUpdate,
				meta,
			})
			.returning({ id: schema.events.id })
			.get();
		if (eventRow === undefined) {
			throw new Error('Failed to insert event');
		}
		const eventId = eventRow.id;

		switch (event.sessionUpdate) {
			case 'user_message_chunk':
			case 'agent_message_chunk':
			case 'agent_thought_chunk': {
				tx.insert(schema.chunkEvents)
					.values({
						event_id: eventId,
						message_id: event.messageId ?? null,
						content: event.content,
					})
					.run();
				break;
			}
			case 'tool_call':
			case 'tool_call_update': {
				tx.insert(schema.toolCallEvents)
					.values({
						event_id: eventId,
						tool_call_id: event.toolCallId,
						title: event.title ?? null,
						status: event.status ?? null,
						kind: event.kind ?? null,
						content: event.content ?? null,
						locations: event.locations ?? null,
						raw_input: event.rawInput ?? null,
						raw_output: event.rawOutput ?? null,
					})
					.run();
				break;
			}
			case 'plan': {
				tx.insert(schema.planEvents)
					.values({
						event_id: eventId,
						entries: event.entries,
					})
					.run();
				break;
			}
			case 'available_commands_update': {
				tx.insert(schema.availableCommandsEvents)
					.values({
						event_id: eventId,
						available_commands: event.availableCommands,
					})
					.run();
				break;
			}
			case 'current_mode_update': {
				tx.insert(schema.currentModeEvents)
					.values({
						event_id: eventId,
						current_mode_id: event.currentModeId,
					})
					.run();
				break;
			}
			case 'config_option_update': {
				tx.insert(schema.configOptionEvents)
					.values({
						event_id: eventId,
						config_options: event.configOptions,
					})
					.run();
				break;
			}
			case 'session_info_update': {
				tx.insert(schema.sessionInfoEvents)
					.values({
						event_id: eventId,
						title: event.title ?? null,
						updated_at: event.updatedAt ?? null,
					})
					.run();
				break;
			}
			case 'usage_update': {
				tx.insert(schema.usageEvents)
					.values({
						event_id: eventId,
						size: event.size,
						used: event.used,
						cost_amount: event.cost?.amount ?? null,
						cost_currency: event.cost?.currency ?? null,
					})
					.run();
				break;
			}
		}

		return eventId;
	});
};

export const readSessionEventsPage = (
	db: BunSQLiteDatabase<typeof schema>,
	jobId: number,
	sinceId: number,
	limit: number,
): SessionEventPage => {
	const rows = db
		.select()
		.from(schema.events)
		.leftJoin(
			schema.chunkEvents,
			eq(schema.events.id, schema.chunkEvents.event_id),
		)
		.leftJoin(
			schema.toolCallEvents,
			eq(schema.events.id, schema.toolCallEvents.event_id),
		)
		.leftJoin(
			schema.planEvents,
			eq(schema.events.id, schema.planEvents.event_id),
		)
		.leftJoin(
			schema.availableCommandsEvents,
			eq(schema.events.id, schema.availableCommandsEvents.event_id),
		)
		.leftJoin(
			schema.currentModeEvents,
			eq(schema.events.id, schema.currentModeEvents.event_id),
		)
		.leftJoin(
			schema.configOptionEvents,
			eq(schema.events.id, schema.configOptionEvents.event_id),
		)
		.leftJoin(
			schema.sessionInfoEvents,
			eq(schema.events.id, schema.sessionInfoEvents.event_id),
		)
		.leftJoin(
			schema.usageEvents,
			eq(schema.events.id, schema.usageEvents.event_id),
		)
		.where(and(eq(schema.events.job_id, jobId), gt(schema.events.id, sinceId)))
		.orderBy(schema.events.created_at, schema.events.id)
		.limit(limit + 1)
		.all();

	const hasMore = rows.length === limit + 1;
	const pageRows = hasMore ? rows.slice(0, limit) : rows;

	const events = pageRows.map((row) => {
		const event = assembleEvent(
			{
				id: row.events.id,
				job_id: row.events.job_id,
				created_at: row.events.created_at,
				type: row.events.type,
				meta: row.events.meta,
			},
			{
				message_id: row.chunk_events?.message_id ?? null,
				content: row.chunk_events?.content ?? null,
				tool_call_id: row.tool_call_events?.tool_call_id ?? null,
				title: row.tool_call_events?.title ?? null,
				status: row.tool_call_events?.status ?? null,
				kind: row.tool_call_events?.kind ?? null,
				locations: row.tool_call_events?.locations ?? null,
				raw_input: row.tool_call_events?.raw_input ?? null,
				raw_output: row.tool_call_events?.raw_output ?? null,
				entries: row.plan_events?.entries ?? null,
				available_commands:
					row.available_commands_events?.available_commands ?? null,
				current_mode_id: row.current_mode_events?.current_mode_id ?? null,
				config_options: row.config_option_events?.config_options ?? null,
				updated_at: row.session_info_events?.updated_at ?? null,
				size: row.usage_events?.size ?? null,
				used: row.usage_events?.used ?? null,
				cost_amount: row.usage_events?.cost_amount ?? null,
				cost_currency: row.usage_events?.cost_currency ?? null,
			},
		);
		return { event, sequence: row.events.id };
	});

	const nextCursor = (() => {
		if (!hasMore) return null;
		const last = pageRows[pageRows.length - 1];
		if (last === undefined) return null;
		return last.events.id;
	})();

	return { events, nextCursor };
};
