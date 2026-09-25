import { describe, expect, test } from 'bun:test';
import type { ServerContext } from '@modelcontextprotocol/server';
import { Effect } from 'effect';
import { AgentNotMappedForBackend, AgentTypeNotFound } from '../../agents.ts';
import type { Jobs } from '../../jobs.ts';
import type { Sessions } from '../../sessions.ts';
import {
	buildDescription,
	formatAgentTypes,
	formatMcpInstructions,
	inputSchema,
	startTool,
	worktreeInputSchema,
} from './start.ts';

type AgentStartError = AgentTypeNotFound | AgentNotMappedForBackend;
const mcp = {
	mcpReq: { signal: new AbortController().signal },
} as ServerContext;

async function expectToolError(error: AgentStartError) {
	const response = await Effect.runPromise(
		startTool.handle(
			{
				prompt: 'Review this change',
				cwd: '/repo',
				model: 'opencode:model',
				agent_type: 'reviewer',
			},
			{
				mcp,
				jobs: {
					wait: () =>
						Effect.die(new Error('wait must not run after start fails')),
				} as unknown as Jobs['Service'],
				sessions: { start: () => error },
			},
		),
	);

	expect(response).toEqual({
		content: [{ type: 'text', text: `Status: error\n---\n${error.message}` }],
	});
	expect(response).not.toHaveProperty('structuredContent');
}

describe('start tool descriptions', () => {
	test('formats aliases and agent types for server instructions', () => {
		expect(
			formatMcpInstructions(
				[
					{
						name: 'fast',
						backend: 'opencode',
						model_id: 'model',
						description: 'Fast implementation model',
					},
					{
						name: 'fallback',
						backend: 'cursor',
						model_id: 'auto',
					},
				],
				[
					{
						name: 'reviewer',
						description: 'Reviews changes.',
						targets: [{ backend: 'opencode', target: 'plan' }],
					},
					{ name: 'unmapped', targets: [] },
				],
			),
		).toBe(`Available model aliases for the \`start\` tool:
- fast: opencode:model — Fast implementation model
- fallback: cursor:auto

Available agent types for the \`start\` tool:
- reviewer: opencode:plan — Reviews changes.
- unmapped: no harness targets configured`);
	});

	test('formats agent descriptions for the Claude channel start description', () => {
		expect(
			formatAgentTypes([
				{ name: 'reviewer', description: 'Reviews changes.' },
				{ name: 'planner' },
			]),
		).toBe(`

Configured agent types (use as \`agent_type\`):
  - \`reviewer\` — Reviews changes.
  - \`planner\``);
	});

	test('omits server instructions when no aliases or agent types are configured', () => {
		expect(formatMcpInstructions([], [])).toBeUndefined();
	});

	test('describes session continuation and read handles', () => {
		expect(buildDescription()).toBe(
			'Start a coding-agent session or fork an existing session/job. Pass its returned session ID to `send_message` to continue. Use `read` to check a background turn.',
		);
	});

	test('accepts optional cwd and a fork ID in the shared input schema', () => {
		const parsed = inputSchema.parse({
			prompt: 'Review this change',
			forkId: 'job-or-session-id',
		});
		expect(parsed.forkId).toBe('job-or-session-id');
		expect(parsed.cwd).toBeUndefined();
	});

	test('adds worktree fields only to the enabled schema', () => {
		expect(Object.hasOwn(inputSchema.shape, 'worktree')).toBe(false);
		expect(
			worktreeInputSchema.parse({
				prompt: 'Run',
				cwd: '/repo',
				worktree: true,
			}),
		).toMatchObject({ worktree: true });
		expect(Object.hasOwn(worktreeInputSchema.shape, 'worktree_branch')).toBe(
			false,
		);
	});

	test('returns an error as plain markdown text for unknown agents', async () => {
		await expectToolError(
			new AgentTypeNotFound({
				agentType: 'missing',
				configuredAgentTypes: ['reviewer'],
			}),
		);
	});

	test('returns an error as plain markdown text for unmapped agents', async () => {
		await expectToolError(
			new AgentNotMappedForBackend({
				agentType: 'reviewer',
				backend: 'cursor',
			}),
		);
	});

	test('returns a background handle as markdown text with the session and job IDs', async () => {
		const response = await Effect.runPromise(
			startTool.handle(
				{
					prompt: 'Run tests',
					cwd: '/repo',
					background: true,
				},
				{
					mcp,
					jobs: {
						wait: () => Effect.die(new Error('background starts do not wait')),
					} as unknown as Jobs['Service'],
					sessions: {
						start: () =>
							Effect.succeed({
								sessionId: 'session-1',
								jobId: 'job-1',
								worktreePath: '/repo-worktree',
								worktreeBranch: 'oagent/1234abcd',
							}),
					} as Pick<Sessions['Service'], 'start'>,
				},
			),
		);

		expect(response).toEqual({
			content: [
				{
					type: 'text',
					text: 'Session ID: session-1\nJob ID: job-1\nStatus: running\nWorktree: /repo-worktree (oagent/1234abcd)\nCall `read` with session ID `session-1`.',
				},
			],
		});
		expect(response).not.toHaveProperty('structuredContent');
	});
});
