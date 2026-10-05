import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { parseModelInput } from './model-input.ts';

test('model input splits on the last effort separator and first backend separator', async () => {
	expect(
		await Effect.runPromise(parseModelInput('opencode:org:model#id#high')),
	).toEqual({
		name: 'opencode:org:model#id',
		suffixEffort: 'high',
		explicit: { backend: 'opencode', modelId: 'org:model#id' },
	});
	expect(await Effect.runPromise(parseModelInput('alias#high'))).toEqual({
		name: 'alias',
		suffixEffort: 'high',
		explicit: undefined,
	});
	await expect(Effect.runPromise(parseModelInput('alias#'))).rejects.toThrow(
		'empty reasoning-effort',
	);
	await expect(
		Effect.runPromise(parseModelInput('unknown:model')),
	).rejects.toThrow('Unknown backend');
});
