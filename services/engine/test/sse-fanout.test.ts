import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from '@effect/vitest';
import { Config, Effect, Fiber } from 'effect';
import { handleJobEvents } from '../src/http/sse.ts';
import { Jobs } from '../src/jobs.ts';
import {
	gatedFakeOpenCodeLayer,
	scriptedFakeOpenCodeLayer,
} from './helpers/fake-opencode.ts';
import { jobsTestLayer } from './helpers/jobs-test-layer.ts';

const TERMINAL_SENTINEL = '__terminal__';

const parseSsePayloads = (raw: string): unknown[] => {
	const payloads: unknown[] = [];
	for (const chunk of raw.split('\n\n')) {
		const trimmed = chunk.trim();
		if (trimmed.length === 0) continue;
		const line = trimmed.startsWith('data: ')
			? trimmed.slice('data: '.length)
			: trimmed;
		payloads.push(JSON.parse(line));
	}
	return payloads;
};

const collectSseStream = (response: Response): Effect.Effect<string, Error> =>
	Effect.tryPromise({
		try: async () => {
			if (response.body === null) {
				throw new Error('SSE response has no body');
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let raw = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value === undefined) continue;
				raw +=
					typeof value === 'string'
						? value
						: decoder.decode(value, { stream: true });
			}
			raw += decoder.decode();
			return raw;
		},
		catch: (cause) =>
			cause instanceof Error ? cause : new Error(String(cause)),
	});

const startOpencodeJob = (jobs: Jobs) =>
	jobs.start({
		prompt: 'sse fanout test',
		model: 'opencode:fake-model',
		cwd: '/tmp/oagent-test',
	});

const isAgentChunk = (
	payload: unknown,
): payload is SessionUpdate & {
	sessionUpdate: 'agent_message_chunk';
	content: { type: 'text'; text: string };
} =>
	typeof payload === 'object' &&
	payload !== null &&
	'sessionUpdate' in payload &&
	payload.sessionUpdate === 'agent_message_chunk' &&
	'content' in payload &&
	typeof payload.content === 'object' &&
	payload.content !== null &&
	'type' in payload.content &&
	payload.content.type === 'text' &&
	'text' in payload.content &&
	typeof payload.content.text === 'string';

describe('SSE fanout (handleJobEvents)', () => {
	it.scopedLive(
		'replays DB history then __terminal__ (may truncate replay if job finishes mid-stream)',
		() => {
			const gated = gatedFakeOpenCodeLayer({ historyCount: 120 });
			return Effect.gen(function* () {
				const dbPath = yield* Config.string('OAGENT_DB_PATH');
				expect(dbPath).toContain('oagent-test');

				const svc = yield* Jobs;
				const { jobId } = yield* startOpencodeJob(svc);

				for (let i = 0; i < 200; i++) {
					if (svc.readEventsPage(jobId, 0, 1).events.length > 0) break;
					yield* Effect.yieldNow();
				}
				expect(svc.readEventsPage(jobId, 0, 120).events.length).toBe(120);

				const ac = new AbortController();
				const response = handleJobEvents(svc, jobId, ac.signal);
				expect(response.status).toBe(200);

				const readFiber = yield* Effect.fork(
					collectSseStream(response).pipe(
						Effect.map((raw) => parseSsePayloads(raw)),
					),
				);

				// Yield so subscribe + replay batch 1 run while the gate still holds
				// the post-history live event (buffer-then-drain window).
				for (let i = 0; i < 32; i++) {
					yield* Effect.yieldNow();
				}
				yield* gated.release;
				yield* svc.wait({ jobId, timeoutMs: 10_000 });

				const payloads = yield* Fiber.join(readFiber);

				const historyTexts = payloads
					.filter(isAgentChunk)
					.map((p) => p.content.text);
				expect(historyTexts.slice(0, 3)).toEqual([
					'history-0',
					'history-1',
					'history-2',
				]);
				expect(
					historyTexts.filter((t) => t.startsWith('history-')).length,
				).toBeGreaterThanOrEqual(100);
				const terminalIdx = payloads.lastIndexOf(TERMINAL_SENTINEL);
				expect(terminalIdx).toBeGreaterThanOrEqual(0);
				expect(terminalIdx).toBe(payloads.length - 1);
			}).pipe(Effect.provide(jobsTestLayer(gated.layer)), Effect.scoped);
		},
	);

	it.scopedLive(
		'drains live events buffered during history replay (buffer-then-drain)',
		() => {
			const gated = gatedFakeOpenCodeLayer({ historyCount: 120 });
			return Effect.gen(function* () {
				const svc = yield* Jobs;
				const { jobId } = yield* startOpencodeJob(svc);

				for (let i = 0; i < 200; i++) {
					if (svc.readEventsPage(jobId, 0, 120).events.length === 120) break;
					yield* Effect.yieldNow();
				}

				const ac = new AbortController();
				const response = handleJobEvents(svc, jobId, ac.signal);
				const readFiber = yield* Effect.fork(
					collectSseStream(response).pipe(
						Effect.map((raw) => parseSsePayloads(raw)),
					),
				);

				for (let i = 0; i < 32; i++) {
					yield* Effect.yieldNow();
				}
				yield* gated.release;
				yield* svc.wait({ jobId, timeoutMs: 10_000 });

				const payloads = yield* Fiber.join(readFiber);
				const texts = payloads.filter(isAgentChunk).map((p) => p.content.text);
				expect(texts).toContain('buffered-during-replay');
				expect(payloads.at(-1)).toBe(TERMINAL_SENTINEL);
			}).pipe(Effect.provide(jobsTestLayer(gated.layer)), Effect.scoped);
		},
	);

	it.scopedLive(
		'emits __terminal__ for an already-finished job (status re-check path)',
		() =>
			Effect.gen(function* () {
				const dbPath = yield* Config.string('OAGENT_DB_PATH');
				expect(dbPath).toContain('oagent-test');

				const svc = yield* Jobs;
				const { jobId } = yield* startOpencodeJob(svc);
				yield* svc.wait({ jobId, timeoutMs: 10_000 });

				const ac = new AbortController();
				const response = handleJobEvents(svc, jobId, ac.signal);
				const raw = yield* collectSseStream(response);
				const payloads = parseSsePayloads(raw);

				expect(payloads.at(-1)).toBe(TERMINAL_SENTINEL);
				expect(payloads.filter((p) => p === TERMINAL_SENTINEL)).toHaveLength(1);
			}).pipe(
				Effect.provide(
					jobsTestLayer(scriptedFakeOpenCodeLayer({ events: [] })),
				),
				Effect.scoped,
			),
	);
});
