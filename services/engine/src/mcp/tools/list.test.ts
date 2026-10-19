import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { Sessions } from '../../sessions.ts';
import { formatSessions, listTool } from './list.ts';

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
									title: 'Run tests',
									jobId: 'job-2',
									status: 'done',
									prompt: 'Follow up\nwith tests',
									cwd: '/repo',
									originCwd: '/repo',
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
			'# Sessions (1)\n\n- **Run tests** (`session-1`) [done] 2026-09-23T12:00:00.000Z · latest job `job-2`\n  Follow up with tests',
		);
		expect(response).not.toHaveProperty('structuredContent');
	});

	test('shows the origin and worktree only when they add information', async () => {
		const response = await Effect.runPromise(
			listTool.handle(
				{},
				{
					sessions: {
						list: () =>
							Effect.succeed([
								{
									id: 'session-1',
									title: 'Feature',
									jobId: 'job-1',
									status: 'running',
									prompt: 'build it',
									cwd: '/worktrees/feature',
									originCwd: '/repo',
									worktreePath: '/worktrees/feature',
									worktreeBranch: 'feature',
									backend: 'opencode' as const,
									lastActivityAt: Date.parse('2026-09-23T12:00:00.000Z'),
									createdAt: Date.parse('2026-09-23T12:00:00.000Z'),
								},
							]),
					} as Pick<Sessions['Service'], 'list'>,
				},
			),
		);
		expect(response.content[0]?.text).toBe(
			'# Sessions (1)\n\n- **Feature** (`session-1`) [running] 2026-09-23T12:00:00.000Z · latest job `job-1`\n  build it\n  origin: `/repo`\n  worktree: `/worktrees/feature`\n  branch: `feature`',
		);
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

	test('marks inline ACP sessions with their command', () => {
		const text = formatSessions([
			{
				id: 'session-1',
				title: 'Inline',
				jobId: 'job-1',
				status: 'done',
				prompt: 'hi',
				cwd: '/repo',
				originCwd: '/repo',
				backend: 'acp',
				acpCommand: { binary: 'my-agent', args: ['--acp', 'two words'] },
				createdAt: Date.parse('2026-09-23T12:00:00.000Z'),
			},
		]);
		expect(text).toContain('  backend: `acp` · `my-agent --acp two words`');
	});
});
