import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { Sessions } from '../../sessions.ts';
import { listTool } from './list.ts';

describe('list tool', () => {
	test('renders recent sessions filtered by cwd', async () => {
		let requestedCwd: string | undefined;
		const response = await Effect.runPromise(
			listTool.handle(
				{ cwd: '/repo' },
				{
					sessions: {
						list: (input) => {
							requestedCwd = input.cwd;
							return Effect.succeed([
								{
									id: 'session-1',
									jobId: 'job-2',
									status: 'done',
									prompt: 'Follow up\nwith tests',
									createdAt: Date.parse('2026-09-23T12:00:00.000Z'),
								},
							]);
						},
					} as Pick<Sessions['Service'], 'list'>,
				},
			),
		);

		expect(requestedCwd).toBe('/repo');
		expect(response.content[0]?.text).toBe(
			'# Sessions (1)\n\n- **session-1** [done] 2026-09-23T12:00:00.000Z · latest job `job-2`\n  Follow up with tests',
		);
		expect(response).not.toHaveProperty('structuredContent');
	});

	test('lists across directories when cwd is omitted', async () => {
		const response = await Effect.runPromise(
			listTool.handle(
				{},
				{
					sessions: {
						list: (input) => {
							expect(input.cwd).toBeUndefined();
							return Effect.succeed([]);
						},
					} as Pick<Sessions['Service'], 'list'>,
				},
			),
		);
		expect(response.content[0]?.text).toBe('No sessions found.');
	});
});
