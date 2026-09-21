import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { z } from 'zod';
import { AgentNotMappedForBackend, AgentTypeNotFound } from '../../agents.ts';
import {
	buildDescription,
	formatAgentTypeInstructions,
	formatAgentTypes,
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

describe('start tool agent types', () => {
	test('lists each configured name without inventing metadata', () => {
		expect(formatAgentTypes([{ name: 'reviewer' }, { name: 'planner' }])).toBe(`

Configured agent types (use as \`agent_type\`):
  - \`reviewer\`
  - \`planner\``);
	});

	test('formats configured agent types for server instructions', () => {
		expect(
			formatAgentTypeInstructions([
				{
					name: 'reviewer',
					targets: [{ backend: 'opencode', target: 'plan' }],
				},
				{
					name: 'builder',
					targets: [
						{ backend: 'opencode', target: 'build' },
						{ backend: 'cursor', target: 'composer' },
					],
				},
				{ name: 'unmapped', targets: [] },
			]),
		).toBe(`Available agent types for the \`start\` tool:
- reviewer: opencode:plan
- builder: opencode:build, cursor:composer
- unmapped: no harness targets configured`);
	});

	test('omits agent instructions when none are configured', () => {
		expect(formatAgentTypeInstructions([])).toBeUndefined();
	});

	test('states when no agent types are configured', () => {
		expect(buildDescription([], [])).toContain('Configured agent types: none.');
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
