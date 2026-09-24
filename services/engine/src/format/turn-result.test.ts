import { describe, expect, test } from 'bun:test';
import {
	formatCancellation,
	formatSessionError,
	formatToolError,
	formatTurnResult,
} from './turn-result.ts';

describe('turn result markdown', () => {
	test('renders a completed turn with the final response body', () => {
		expect(
			formatTurnResult({
				sessionId: 'session-1',
				jobId: 'job-1',
				result: { status: 'done', text: 'Implemented the change.' },
			}),
		).toBe(
			'Session ID: session-1\nJob ID: job-1\nStatus: done\n---\nImplemented the change.',
		);
	});

	test('renders running, error, cancellation, and worktree details', () => {
		expect(
			formatTurnResult({
				sessionId: 'session-2',
				jobId: 'job-2',
				result: { status: 'running' },
				worktreePath: '/repo-worktree',
				worktreeBranch: 'oagent/1234abcd',
			}),
		).toBe(
			'Session ID: session-2\nJob ID: job-2\nStatus: running\nWorktree: /repo-worktree (oagent/1234abcd)\nCall `read` with session ID `session-2` or run `oagent jobs wait job-2` in the background.',
		);
		expect(
			formatTurnResult({
				sessionId: 'session-2',
				jobId: 'job-2',
				result: { status: 'error', message: 'provider unavailable' },
			}),
		).toBe(
			'Session ID: session-2\nJob ID: job-2\nStatus: error\n---\nprovider unavailable',
		);
		expect(
			formatTurnResult({
				sessionId: 'session-2',
				jobId: 'job-2',
				result: { status: 'cancelled' },
			}),
		).toContain('Status: cancelled\n---\nThe turn was cancelled.');
	});

	test('renders steering as a running status without a response body', () => {
		expect(
			formatTurnResult({
				sessionId: 'session-3',
				jobId: 'job-3',
				result: { status: 'running' },
				steered: true,
			}),
		).toBe(
			'Session ID: session-3\nJob ID: job-3\nStatus: running\nMessage queued for delivery at the next step boundary.',
		);
	});

	test('formats tool, session, and cancellation responses as text', () => {
		expect(formatToolError('bad input')).toBe('Status: error\n---\nbad input');
		expect(formatSessionError('session-4', 'not found')).toBe(
			'Session ID: session-4\nStatus: error\n---\nnot found',
		);
		expect(formatCancellation({ sessionId: 'session-4', status: 'idle' })).toBe(
			'Session ID: session-4\nStatus: idle\nNo running turn to cancel.',
		);
	});
});
