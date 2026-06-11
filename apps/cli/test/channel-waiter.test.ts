import { describe, expect, it } from '@effect/vitest';
import {
	channelEventFor,
	waitForTerminalAndNotify,
} from '../src/lib/channel-waiter.ts';

/** Stub engine base URL — must not be the live default port. */
const STUB_ENGINE_URL = 'http://127.0.0.1:19999';

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
	const body = `${frames.join('\n\n')}\n\n`;
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(body));
			controller.close();
		},
	});
}

describe('channelEventFor', () => {
	it('maps done results to channel meta', () => {
		const jobId = 'job-abc';
		const event = channelEventFor(jobId, {
			status: 'done',
			text: 'final answer',
			sessionId: 'sess-99',
			stopReason: 'end_turn',
		});
		expect(event).toEqual({
			content: 'final answer',
			meta: {
				job_id: jobId,
				status: 'done',
				session_id: 'sess-99',
				stop_reason: 'end_turn',
			},
		});
	});

	it('maps error and cancelled results', () => {
		expect(channelEventFor('j1', { status: 'error', message: 'boom' })).toEqual(
			{
				content: 'Agent job failed: boom',
				meta: { job_id: 'j1', status: 'error' },
			},
		);
		expect(channelEventFor('j2', { status: 'cancelled' })).toEqual({
			content: 'Agent job was cancelled.',
			meta: { job_id: 'j2', status: 'cancelled' },
		});
	});
});

describe('waitForTerminalAndNotify', () => {
	it('calls jobs.wait once after __terminal__ and notifies with done meta', async () => {
		const jobId = 'job-terminal-1';
		const waitCalls: Array<{ jobId: string; timeoutMs: number }> = [];
		const notifications: Array<{
			content: string;
			meta: Record<string, string>;
		}> = [];

		await waitForTerminalAndNotify({
			jobId,
			engineUrl: STUB_ENGINE_URL,
			fetchSse: async () => sseStream(['data: "__terminal__"']),
			waitJob: async (args) => {
				waitCalls.push(args);
				return {
					status: 'done',
					text: 'hello from agent',
					sessionId: 'sess-1',
					stopReason: 'end_turn',
				};
			},
			notify: async (content, meta) => {
				notifications.push({ content, meta });
			},
		});

		expect(waitCalls).toHaveLength(1);
		expect(waitCalls[0]).toEqual({ jobId, timeoutMs: 5_000 });
		expect(notifications).toEqual([
			{
				content: 'hello from agent',
				meta: {
					job_id: jobId,
					status: 'done',
					session_id: 'sess-1',
					stop_reason: 'end_turn',
				},
			},
		]);
	});

	it('reconnects when the stream ends without a terminal sentinel', async () => {
		const jobId = 'job-reconnect';
		let fetchCount = 0;
		const waitCalls: unknown[] = [];

		await waitForTerminalAndNotify({
			jobId,
			engineUrl: STUB_ENGINE_URL,
			fetchSse: async () => {
				fetchCount += 1;
				if (fetchCount === 1) {
					return sseStream(['data: {"sessionUpdate":"agent_message_chunk"}']);
				}
				return sseStream(['data: "__terminal__"']);
			},
			waitJob: async (args) => {
				waitCalls.push(args);
				return {
					status: 'done',
					text: 'after reconnect',
					sessionId: 'sess-2',
				};
			},
			notify: async () => {},
		});

		expect(fetchCount).toBe(2);
		expect(waitCalls).toHaveLength(1);
	});

	it('notifies with error meta when waitJob throws', async () => {
		const jobId = 'job-fail';
		const notifications: Array<{
			content: string;
			meta: Record<string, string>;
		}> = [];

		await waitForTerminalAndNotify({
			jobId,
			engineUrl: STUB_ENGINE_URL,
			fetchSse: async () => sseStream(['data: "__terminal__"']),
			waitJob: async () => {
				throw new Error('engine unreachable');
			},
			notify: async (content, meta) => {
				notifications.push({ content, meta });
			},
		});

		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.meta).toEqual({
			job_id: jobId,
			status: 'error',
		});
		expect(notifications[0]?.content).toContain('engine unreachable');
	});
});
