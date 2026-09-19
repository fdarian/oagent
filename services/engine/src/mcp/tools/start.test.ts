import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { z } from 'zod';
import { AgentNotMappedForBackend, AgentTypeNotFound } from '../../agents.ts';
import {
	buildDescription,
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
		expect(formatAgentTypes(['reviewer', 'planner'])).toBe(`

Configured agent types (use as \`agent_type\`):
  - \`reviewer\`
  - \`planner\``);
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
