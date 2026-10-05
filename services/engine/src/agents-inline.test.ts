import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { resolveInlineAgent } from './agents.ts';

test('inline targets select by backend and fail for missing mappings', async () => {
	const definition = {
		name: 'review',
		targets: [{ backend: 'opencode' as const, target: 'reviewer' }],
	};
	expect(
		await Effect.runPromise(resolveInlineAgent(definition, 'opencode')),
	).toBe('reviewer');
	await expect(
		Effect.runPromise(resolveInlineAgent(definition, 'codex')),
	).rejects.toThrow('not mapped');
});
