import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { Sessions } from '../../sessions.ts';
import { readTool } from './read.ts';

describe('read tool', () => {
	test('caps the wait and returns the latest turn as markdown', async () => {
		let timeoutMs: number | undefined;
		const response = await Effect.runPromise(
			readTool.handle(
				{ sessionId: 'session-1', timeoutMs: 90_000 },
				{
					sessions: {
						read: (input) => {
							timeoutMs = input.timeoutMs;
							return Effect.succeed({
								status: 'done' as const,
								sessionId: 'session-1',
								jobId: 'job-1',
								text: 'Latest answer.',
								stopReason: 'end_turn',
							});
						},
					} as Pick<Sessions['Service'], 'read'>,
				},
			),
		);

		expect(timeoutMs).toBe(55_000);
		expect(response).toEqual({
			content: [
				{
					type: 'text',
					text: 'Session ID: session-1\nJob ID: job-1\nStatus: done\n---\nLatest answer.',
				},
			],
		});
		expect(response).not.toHaveProperty('structuredContent');
	});
});
