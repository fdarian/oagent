import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from '@effect/vitest';
import { randomUUIDv7 } from 'bun';
import { eq } from 'drizzle-orm';
import { ConfigProvider, Effect, Layer } from 'effect';
import { Db } from '../src/db/client.ts';
import * as schema from '../src/db/schema.ts';
import { Jobs } from '../src/jobs.ts';
import {
	failingFakeOpenCodeLayer,
	gatedFakeOpenCodeLayer,
	scriptedFakeOpenCodeLayer,
} from './helpers/fake-opencode.ts';
import { jobsTestLayer } from './helpers/jobs-test-layer.ts';

const scriptedEvents: SessionUpdate[] = [
	{
		sessionUpdate: 'agent_message_chunk',
		messageId: 'lifecycle-msg-1',
		content: { type: 'text', text: 'scripted chunk one' },
	},
	{
		sessionUpdate: 'agent_message_chunk',
		messageId: 'lifecycle-msg-2',
		content: { type: 'text', text: 'scripted chunk two' },
	},
];

const startOpencodeJob = (jobs: Jobs) =>
	jobs.start({
		prompt: 'integration test prompt',
		model: 'opencode:fake-model',
		cwd: '/tmp/oagent-test',
	});

describe('Jobs lifecycle', () => {
	it.effect('subscribe buffers live events before terminal', () => {
		const gated = gatedFakeOpenCodeLayer({ historyCount: 3 });
		return Effect.gen(function* () {
			const jobs = yield* Jobs;
			const { jobId } = yield* startOpencodeJob(jobs);

			const payloads: Array<
				| { type: 'event'; event: SessionUpdate; sequence: number }
				| { type: 'terminal' }
			> = [];
			const unsub = jobs.subscribe(jobId, (payload) => {
				payloads.push(payload);
			});

			yield* Effect.tryPromise({
				try: () =>
					new Promise<void>((resolve) => {
						setImmediate(resolve);
					}),
				catch: (cause) =>
					cause instanceof Error ? cause : new Error(String(cause)),
			});
			yield* gated.release;
			yield* jobs.wait({ jobId, timeoutMs: 10_000 });
			unsub();

			expect(
				payloads.some(
					(p) =>
						p.type === 'event' &&
						p.event.sessionUpdate === 'agent_message_chunk' &&
						p.event.content.type === 'text' &&
						p.event.content.text === 'buffered-during-replay',
				),
			).toBe(true);
			expect(payloads.some((p) => p.type === 'terminal')).toBe(true);
		}).pipe(Effect.provide(jobsTestLayer(gated.layer)), Effect.scoped);
	});
	it.effect('start persists scripted events and wait returns done', () =>
		Effect.gen(function* () {
			const jobs = yield* Jobs;
			const { jobId } = yield* startOpencodeJob(jobs);

			const waitResult = yield* jobs.wait({ jobId, timeoutMs: 10_000 });
			expect(waitResult).toEqual({
				status: 'done',
				sessionId: 'fake-session-id',
				text: 'fake turn complete',
				stopReason: 'end_turn',
			});

			const page = jobs.readEventsPage(jobId, 0, 100);
			expect(page.events).toHaveLength(scriptedEvents.length);
			expect(page.events.map((row) => row.event)).toEqual(scriptedEvents);
			expect(page.nextCursor).toBeNull();

			const detail = jobs.getDetail(jobId);
			expect(detail?.status).toBe('done');
			expect(detail?.recentEvents).toEqual(scriptedEvents);
		}).pipe(
			Effect.provide(
				jobsTestLayer(
					scriptedFakeOpenCodeLayer({
						events: scriptedEvents,
						result: {
							sessionId: 'fake-session-id',
							text: 'fake turn complete',
							stopReason: 'end_turn',
						},
					}),
				),
			),
			Effect.scoped,
		),
	);

	it.effect('scripted OpenCode failure yields wait error', () =>
		Effect.gen(function* () {
			const jobs = yield* Jobs;
			const { jobId } = yield* startOpencodeJob(jobs);

			const waitResult = yield* jobs.wait({ jobId, timeoutMs: 10_000 });
			expect(waitResult.status).toBe('error');
			if (waitResult.status !== 'error') return;
			expect(waitResult.message).toContain('FakeOpenCodeError');
			expect(waitResult.message).toContain('scripted opencode failure');

			const detail = jobs.getDetail(jobId);
			expect(detail?.status).toBe('error');
		}).pipe(
			Effect.provide(jobsTestLayer(failingFakeOpenCodeLayer())),
			Effect.scoped,
		),
	);

	it.effect(
		'Db acquire recovers orphaned running jobs on the same temp path',
		() =>
			Effect.gen(function* () {
				const dbPath = path.join(
					os.tmpdir(),
					`oagent-orphan-${randomUUID()}.db`,
				);
				fs.mkdirSync(path.dirname(dbPath), { recursive: true });

				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						for (const suffix of ['', '-wal', '-shm']) {
							try {
								fs.unlinkSync(`${dbPath}${suffix}`);
							} catch {
								// already removed
							}
						}
					}),
				);

				const isolatedDbLayer = Layer.setConfigProvider(
					ConfigProvider.fromMap(new Map([['OAGENT_DB_PATH', dbPath]])),
				).pipe(Layer.provideMerge(Db.Default));

				const orphanUuid = randomUUIDv7();

				yield* Effect.gen(function* () {
					const { db } = yield* Db;
					db.insert(schema.jobs)
						.values({
							uuid: orphanUuid,
							status: 'running',
							prompt: 'orphan seed',
							cwd: '/tmp',
							backend: 'opencode',
						})
						.run();
				}).pipe(Effect.provide(isolatedDbLayer), Effect.scoped);

				const recovered = yield* Effect.gen(function* () {
					const { db } = yield* Db;
					return db
						.select()
						.from(schema.jobs)
						.where(eq(schema.jobs.uuid, orphanUuid))
						.limit(1)
						.get();
				}).pipe(Effect.provide(isolatedDbLayer), Effect.scoped);

				expect(recovered).toBeDefined();
				expect(recovered?.status).toBe('error');
				expect(recovered?.error_message).toBe('engine restarted while running');
				expect(recovered?.terminated_at).toBeDefined();
			}).pipe(Effect.scoped),
	);
});
