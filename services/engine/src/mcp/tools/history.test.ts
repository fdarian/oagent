import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { Sessions } from '../../sessions.ts';
import { type SessionHistory, SessionJobNotFound } from '../../sessions.ts';
import { historyTool } from './history.ts';

const turnsView: SessionHistory = {
	view: 'turns',
	session: { id: 'session-1', title: 'Fix bug', status: 'idle' },
	forkedFromJobId: null,
	total: 1,
	firstNumber: 1,
	before: null,
	turns: [
		{
			jobId: 'job-1',
			number: 1,
			status: 'done',
			prompt: 'Fix it',
			text: 'Fixed.',
			errorMessage: null,
			toolCalls: { edit: 2 },
			createdAt: 0,
		},
	],
};

describe('history tool', () => {
	test('forwards the query and renders the formatted history', async () => {
		let received: unknown;
		const response = await Effect.runPromise(
			historyTool.handle(
				{ sessionId: 'session-1', limit: 5, before: 'job-9' },
				{
					sessions: {
						history: (input) => {
							received = input;
							return Effect.succeed(turnsView);
						},
					} as Pick<Sessions['Service'], 'history'>,
				},
			),
		);

		expect(received).toEqual({
			sessionId: 'session-1',
			limit: 5,
			before: 'job-9',
		});
		expect(response.content[0]?.text).toContain(
			'Session "Fix bug" (idle) — turn 1 of 1',
		);
		expect(response.content[0]?.text).toContain('2 tool calls (edit×2)');
		expect(response).not.toHaveProperty('structuredContent');
	});

	test('renders failures like the result tool', async () => {
		const response = await Effect.runPromise(
			historyTool.handle(
				{ sessionId: 'session-1', jobId: 'nope' },
				{
					sessions: {
						history: () =>
							Effect.fail(
								new SessionJobNotFound({
									sessionId: 'session-1',
									jobId: 'nope',
								}),
							),
					} as Pick<Sessions['Service'], 'history'>,
				},
			),
		);

		expect(response.content[0]?.text).toBe(
			'Session ID: session-1\nStatus: error\n---\nJob nope is not a turn of session session-1',
		);
	});

	test('rejects limits outside 1-50', () => {
		for (const limit of [0, 51, 1.5]) {
			expect(
				historyTool.inputSchema.safeParse({ sessionId: 's', limit }).success,
			).toBe(false);
		}
		expect(
			historyTool.inputSchema.safeParse({ sessionId: 's', limit: 50 }).success,
		).toBe(true);
	});
});
