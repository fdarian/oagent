import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { Sessions } from '../../sessions.ts';
import { readTool } from './read.ts';

describe('read tool', () => {
	test('returns the latest status immediately by default', async () => {
		let wait: boolean | undefined;
		const response = await Effect.runPromise(
			readTool.handle(
				{ sessionId: 'session-1' },
				{
					sessions: {
						read: (input) => {
							wait = input.wait;
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

		expect(wait).toBeUndefined();
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
