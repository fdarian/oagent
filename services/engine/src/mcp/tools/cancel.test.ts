import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { Sessions } from '../../sessions.ts';
import { cancelTool } from './cancel.ts';

describe('cancel tool', () => {
	test('renders a cancelled session as markdown text', async () => {
		const response = await Effect.runPromise(
			cancelTool.handle(
				{ sessionId: 'session-1' },
				{
					sessions: {
						cancel: () => Effect.succeed({ ok: true, status: 'cancelled' }),
					} as Pick<Sessions['Service'], 'cancel'>,
				},
			),
		);

		expect(response.content[0]?.text).toBe(
			'Session ID: session-1\nStatus: cancelled',
		);
		expect(response).not.toHaveProperty('structuredContent');
	});

	test('reports an unknown session as markdown text', async () => {
		const response = await Effect.runPromise(
			cancelTool.handle(
				{ sessionId: 'missing' },
				{
					sessions: {
						cancel: () => Effect.succeed({ ok: false }),
					} as Pick<Sessions['Service'], 'cancel'>,
				},
			),
		);

		expect(response.content[0]?.text).toBe(
			'Session ID: missing\nStatus: error\n---\nSession not found: missing',
		);
	});
});
