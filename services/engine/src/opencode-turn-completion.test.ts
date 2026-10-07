import { describe, expect, test } from 'bun:test';
import { evaluateOpenCodeTurnCompletion } from './opencode.ts';

describe('evaluateOpenCodeTurnCompletion', () => {
	test('accepts a settled assistant message that stopped normally', () => {
		expect(
			evaluateOpenCodeTurnCompletion({
				id: 'msg_1',
				type: 'assistant',
				time: { completed: 1 },
				finish: 'stop',
			}),
		).toEqual({ complete: true });
	});

	test.each([
		['a user message', { id: 'msg_1', type: 'user' }],
		['an unsettled assistant step', { id: 'msg_1', type: 'assistant' }],
		[
			'tool calls that never ran',
			{
				id: 'msg_1',
				type: 'assistant',
				time: { completed: 1 },
				finish: 'tool-calls',
			},
		],
		[
			'an assistant error',
			{
				id: 'msg_1',
				type: 'assistant',
				time: { completed: 1 },
				finish: 'stop',
				error: { type: 'auth', message: 'token expired' },
			},
		],
		[
			'a missing finish reason',
			{ id: 'msg_1', type: 'assistant', time: { completed: 1 } },
		],
	])('rejects %s', (_name, message) => {
		expect(evaluateOpenCodeTurnCompletion(message).complete).toBe(false);
	});

	test('surfaces the assistant error message', () => {
		expect(
			evaluateOpenCodeTurnCompletion({
				id: 'msg_1',
				type: 'assistant',
				error: { message: 'token expired' },
			}),
		).toEqual({
			complete: false,
			reason: 'the assistant failed: token expired',
		});
	});
});
