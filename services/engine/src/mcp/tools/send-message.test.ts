import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { Jobs } from '../../jobs.ts';
import { SessionNotFound, type Sessions } from '../../sessions.ts';
import { sendMessageTool } from './send-message.ts';

const jobs = {
	wait: () =>
		Effect.succeed({
			status: 'done' as const,
			sessionId: 'session-1',
			text: 'Finished the follow-up.',
			stopReason: 'end_turn',
		}),
} as unknown as Jobs['Service'];

describe('send_message tool', () => {
	test('returns the markdown final result for an idle session turn', async () => {
		const response = await Effect.runPromise(
			sendMessageTool.handle(
				{ sessionId: 'session-1', prompt: 'continue' },
				{
					jobs,
					sessions: {
						sendMessage: () =>
							Effect.succeed({
								sessionId: 'session-1',
								jobId: 'job-2',
								delivery: 'started' as const,
							}),
					} as Pick<Sessions['Service'], 'sendMessage'>,
				},
			),
		);

		expect(response).toEqual({
			content: [
				{
					type: 'text',
					text: 'Session ID: session-1\nJob ID: job-2\nStatus: done\n---\nFinished the follow-up.',
				},
			],
		});
		expect(response).not.toHaveProperty('structuredContent');
	});

	test('returns the queued-delivery markdown when steering a running turn', async () => {
		let waitCalled = false;
		const response = await Effect.runPromise(
			sendMessageTool.handle(
				{ sessionId: 'session-1', prompt: 'also inspect tests' },
				{
					jobs: {
						wait: () => {
							waitCalled = true;
							return Effect.die(new Error('steering must not wait'));
						},
					} as unknown as Jobs['Service'],
					sessions: {
						sendMessage: () =>
							Effect.succeed({
								sessionId: 'session-1',
								jobId: 'job-1',
								delivery: 'steered' as const,
							}),
					} as Pick<Sessions['Service'], 'sendMessage'>,
				},
			),
		);

		expect(response.content[0]?.text).toBe(
			'Session ID: session-1\nJob ID: job-1\nStatus: running\nMessage queued for delivery at the next step boundary.',
		);
		expect(waitCalled).toBe(false);
	});

	test('formats session errors as markdown text', async () => {
		const response = await Effect.runPromise(
			sendMessageTool.handle(
				{ sessionId: 'missing-session', prompt: 'continue' },
				{
					jobs,
					sessions: {
						sendMessage: () =>
							Effect.fail(
								new SessionNotFound({ sessionId: 'missing-session' }),
							),
					} as Pick<Sessions['Service'], 'sendMessage'>,
				},
			),
		);

		expect(response.content[0]?.text).toBe(
			'Session ID: missing-session\nStatus: error\n---\nSession not found: missing-session',
		);
	});
});
