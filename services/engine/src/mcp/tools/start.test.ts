import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { buildDescription, formatAgentTypes, inputSchema } from './start.ts';

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
});
