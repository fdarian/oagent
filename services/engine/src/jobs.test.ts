import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Effect } from 'effect';
import { Agents } from './agents.ts';
import { Db } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import * as schema from './db/schema.ts';
import type { Harness } from './harness.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { Jobs } from './jobs.ts';
import { Settings } from './settings.ts';

function createDatabase() {
	const sqlite = new Database(':memory:');
	const db = drizzle(sqlite, { schema });
	Effect.runSync(runMigrations(db));
	return { sqlite, db };
}

function createHarnessRegistry(harness: Harness): HarnessRegistry['Service'] {
	return {
		all: [harness],
		get: () => harness,
		listAgentTargets: () => Effect.succeed([]),
	};
}

describe('job event persistence', () => {
	test('does not persist the same replayed ACP update twice', async () => {
		const database = createDatabase();
		const event = {
			sessionUpdate: 'agent_message_chunk' as const,
			messageId: 'msg_replayed',
			content: { type: 'text' as const, text: 'same update' },
		};
		const metadataEvent = {
			...event,
			_meta: { source: 'different-update' },
		};
		const steerMetadataEvent = {
			...event,
			_meta: { 'oagent/steer': true },
		};
		const harness = {
			backend: 'opencode' as const,
			runTurn: (input: { onEvent?: (value: typeof event) => void }) =>
				Effect.sync(() => {
					input.onEvent?.(event);
					input.onEvent?.(event);
					input.onEvent?.(steerMetadataEvent as typeof event);
					input.onEvent?.(metadataEvent as typeof event);
					return {
						sessionId: 'ses_test',
						text: 'same update',
						stopReason: 'end_turn',
					};
				}),
		} as unknown as Harness;
		const dbService = {
			db: database.db,
			sqlite: database.sqlite,
		} as unknown as Db['Service'];
		const jobs = await Effect.runPromise(
			Jobs.make.pipe(
				Effect.provideService(Db, dbService),
				Effect.provideService(HarnessRegistry, createHarnessRegistry(harness)),
				Effect.provideService(Settings, {
					getSetting: () => undefined,
				} as unknown as Settings['Service']),
				Effect.provideService(Agents, {} as Agents['Service']),
			),
		);

		const started = await Effect.runPromise(
			jobs.start({
				prompt: 'run',
				cwd: '/tmp',
				model: 'opencode:test',
			}),
		);
		await Effect.runPromise(
			jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
		);

		const page = jobs.readEventsPage(started.jobId, 0, 100);
		expect(page.events).toHaveLength(2);
		expect(page.events[0]?.event).toMatchObject(event);
		expect(page.events[1]?.event).toMatchObject(metadataEvent);
		database.sqlite.close();
	});
});
