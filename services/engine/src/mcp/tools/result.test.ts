import { describe, expect, test } from 'bun:test';
import type { ServerContext } from '@modelcontextprotocol/server';
import { Effect } from 'effect';
import type { Jobs } from '../../jobs.ts';
import type { Sessions } from '../../sessions.ts';
import { resultTool } from './result.ts';

describe('result tool', () => {
	test('returns the latest status immediately by default', async () => {
		let wait: boolean | undefined;
		const response = await Effect.runPromise(
			resultTool.handle(
				{ sessionId: 'session-1' },
				{
					mcp: {
						mcpReq: { signal: new AbortController().signal },
					} as ServerContext,
					jobs: {} as Jobs['Service'],
					sessions: {
						result: (input) => {
							wait = input.wait;
							return Effect.succeed({
								status: 'done' as const,
								sessionId: 'session-1',
								jobId: 'job-1',
								text: 'Latest answer.',
								stopReason: 'end_turn',
							});
						},
					} as Pick<Sessions['Service'], 'result'>,
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

	test('points to history for earlier turns', () => {
		expect(resultTool.description).toContain(
			'For earlier turns or what the agent did, use history.',
		);
	});
});
