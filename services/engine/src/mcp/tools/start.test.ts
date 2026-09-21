import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { z } from 'zod';
import { AgentNotMappedForBackend, AgentTypeNotFound } from '../../agents.ts';
import {
	buildDescription,
	formatAgentTypes,
	formatMcpInstructions,
	inputSchema,
	startTool,
} from './start.ts';

type AgentStartError = AgentTypeNotFound | AgentNotMappedForBackend;

async function expectStructuredError(error: AgentStartError) {
	const response = await Effect.runPromise(
		startTool.handle(
			{
				prompt: 'Review this change',
				cwd: '/repo',
				model: 'opencode:model',
				agent_type: 'reviewer',
			},
			{
				jobs: {
					getStartTimeoutMs: () => 1,
					start: () => error,
					wait: () =>
						Effect.die(new Error('wait must not run after start fails')),
				},
				waitUrlBase: undefined,
				mcpSessionId: undefined,
			},
		),
	);

	expect(response).toEqual({
		content: [
			{
				type: 'text',
				text: JSON.stringify({
					error: { code: error._tag, message: error.message },
				}),
			},
		],
	});
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

	test('keeps the start tool description focused', () => {
		expect(buildDescription()).toBe(
			'Launch or continue a coding-agent session and return its result. If it returns `{ status: "running", jobId }`, run `oagent jobs wait <jobId>` as a background command or use the `result` tool; pass a returned `sessionId` to a later call to resume the session.',
		);
	});

	test('accepts agent_type in the shared input schema', () => {
		const parsed = z.object(inputSchema).parse({
			prompt: 'Review this change',
			cwd: '/repo',
			agent_type: 'reviewer',
		});
		expect(parsed.agent_type).toBe('reviewer');
	});

	test('returns a structured unknown-agent response', async () => {
		await expectStructuredError(
			new AgentTypeNotFound({
				agentType: 'missing',
				configuredAgentTypes: ['reviewer'],
			}),
		);
	});

	test('returns a structured unmapped-agent response', async () => {
		await expectStructuredError(
			new AgentNotMappedForBackend({
				agentType: 'reviewer',
				backend: 'cursor',
			}),
		);
	});
});
