import { describe, expect, test } from 'bun:test';
import { createProcedureClient } from '@orpc/server';
import { Effect } from 'effect';
import type { Settings } from '../settings.ts';
import { createHarnessEnvProcedures } from './router.ts';

describe('settings.setHarnessEnv', () => {
	test('rejects duplicate keys before writing the record', async () => {
		let writes = 0;
		const settings: Pick<
			Settings['Service'],
			'getHarnessEnv' | 'setHarnessEnv'
		> = {
			getHarnessEnv: () => ({}),
			setHarnessEnv: () => {
				writes += 1;
			},
		};
		const procedures = await Effect.runPromise(
			createHarnessEnvProcedures(settings),
		);
		const setHarnessEnv = createProcedureClient(procedures.setHarnessEnv);

		await expect(
			setHarnessEnv({
				backend: 'opencode',
				env: [
					{ key: 'DUPLICATE_KEY', value: 'first' },
					{ key: 'DUPLICATE_KEY', value: 'second' },
				],
			}),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(writes).toBe(0);
	});
});
