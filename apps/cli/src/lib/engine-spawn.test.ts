import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { engineSpawnEnvironment, retryEngineRpc } from './engine-spawn.ts';

test('successful RPCs do not probe or ensure the engine', async () => {
	let ensured = 0;
	expect(
		await Effect.runPromise(
			retryEngineRpc(
				() => Promise.resolve('ok'),
				Effect.sync(() => {
					ensured++;
				}),
			),
		),
	).toBe('ok');
	expect(ensured).toBe(0);
});

test('connection refusal ensures the engine and retries exactly once', async () => {
	let calls = 0;
	let ensured = 0;
	const refused = Object.assign(new Error('refused'), {
		code: 'ConnectionRefused',
	});
	await expect(
		Effect.runPromise(
			retryEngineRpc(
				() => {
					calls++;
					return Promise.reject(refused);
				},
				Effect.sync(() => {
					ensured++;
				}),
			),
		),
	).rejects.toThrow('refused');
	expect(calls).toBe(2);
	expect(ensured).toBe(1);
});

test('application errors preserve their message without retrying', async () => {
	let ensured = 0;
	await expect(
		Effect.runPromise(
			retryEngineRpc(
				() => Promise.reject(new Error('precise RPC error')),
				Effect.sync(() => {
					ensured++;
				}),
			),
		),
	).rejects.toThrow('precise RPC error');
	expect(ensured).toBe(0);
});

test('spawn environment pins the target port over inherited configuration', () => {
	expect(engineSpawnEnvironment('49123').OPENCODE_MCP_PORT).toBe('49123');
});
