import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from '@effect/vitest';
import { randomUUIDv7 } from 'bun';
import { Effect } from 'effect';
import { Db } from '../src/db/client.ts';
import * as schema from '../src/db/schema.ts';
import {
	insertSessionUpdate,
	readSessionEventsPage,
} from '../src/db/sessionEvents.ts';
import { testDbLayer } from './helpers/db.ts';

const sampleEvents: SessionUpdate[] = [
	{
		sessionUpdate: 'agent_message_chunk',
		messageId: 'msg-1',
		content: { type: 'text', text: 'hello from agent' },
		_meta: { trace: 'roundtrip-test' },
	},
	{
		sessionUpdate: 'tool_call',
		toolCallId: 'tc-42',
		title: 'Read file',
		status: 'in_progress',
		kind: 'read',
		locations: [{ path: '/tmp/example.ts' }],
	},
	{
		sessionUpdate: 'plan',
		entries: [
			{ content: 'Step one', priority: 'high', status: 'pending' },
			{ content: 'Step two', priority: 'medium', status: 'pending' },
		],
	},
	{
		sessionUpdate: 'usage_update',
		size: 128_000,
		used: 42_000,
		cost: { amount: 0.012, currency: 'USD' },
	},
];

describe('session event decomposition', () => {
	it.effect('round-trips SessionUpdate variants through SQLite', () =>
		Effect.gen(function* () {
			const { db } = yield* Db;

			const jobRow = db
				.insert(schema.jobs)
				.values({
					uuid: randomUUIDv7(),
					status: 'running',
					prompt: 'test',
					cwd: '/tmp',
					backend: 'opencode',
				})
				.returning({ id: schema.jobs.id })
				.get();
			if (jobRow === undefined) {
				throw new Error('Failed to insert job');
			}

			for (const event of sampleEvents) {
				insertSessionUpdate(db, jobRow.id, event);
			}

			const page = readSessionEventsPage(db, jobRow.id, 0, 100);
			expect(page.events).toHaveLength(sampleEvents.length);

			const roundTripped = page.events.map((row) => row.event);
			expect(roundTripped).toEqual(sampleEvents);
		}).pipe(Effect.provide(testDbLayer)),
	);
});
