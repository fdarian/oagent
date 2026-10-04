import { expect, test } from 'bun:test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Effect } from 'effect';
import {
	overlay,
	parseAgents,
	parseAliases,
	resolveAgent,
	resolveModel,
} from './ephemeral-config.ts';

test('aliases parse, expand and allow effort overrides', async () => {
	const aliases = await Effect.runPromise(
		parseAliases(['x=opencode:openai/model#high']),
	);
	expect(await Effect.runPromise(resolveModel('x#low', aliases, true))).toBe(
		'opencode:openai/model#low',
	);
	expect(await Effect.runPromise(resolveModel('x', aliases, true))).toBe(
		'opencode:openai/model#high',
	);
	expect(
		await Effect.runPromise(resolveModel('codex:model', aliases, true)),
	).toBe('codex:model');
	await expect(
		Effect.runPromise(resolveModel('missing', aliases, true)),
	).rejects.toThrow();
	expect(await Effect.runPromise(resolveModel('missing', aliases, false))).toBe(
		'missing',
	);
	await expect(Effect.runPromise(parseAliases(['bad']))).rejects.toThrow();
	await expect(
		Effect.runPromise(parseAliases(['x=wrong:model'])),
	).rejects.toThrow();
});

test('flags win and inline agents resolve without persistence', async () => {
	expect(
		await Effect.runPromise(
			parseAgents('{"review":{"targets":{"opencode":"reviewer"}}}').pipe(
				Effect.provide(BunServices.layer),
			),
		),
	).toEqual([
		{
			name: 'review',
			description: undefined,
			targets: [{ backend: 'opencode', target: 'reviewer' }],
		},
	]);
	expect(overlay([{ name: 'x', value: 1 }], [{ name: 'x', value: 2 }])).toEqual(
		[{ name: 'x', value: 2 }],
	);
	const agent = {
		name: 'review',
		targets: [{ backend: 'opencode' as const, target: 'reviewer' }],
	};
	expect(
		await Effect.runPromise(resolveAgent('review', [agent], true)),
	).toEqual({ agent, agent_type: undefined });
	await expect(
		Effect.runPromise(resolveAgent('unknown', [], true)),
	).rejects.toThrow();
});
