import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import {
	describeRecordedDaemonConflict,
	engineSpawnEnvironment,
	retryEngineRpc,
} from './engine-spawn.ts';

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

test('a live recorded daemon blocks spawning and names its pid and port', () => {
	const message = describeRecordedDaemonConflict(
		{
			pid: 4242,
			running: true,
			argv: ['/bin/oagent', 'serve', '--port', '17777', '--idle-exit', '10m'],
		},
		'http://localhost:18000',
	);
	expect(message).toContain('pid 4242');
	expect(message).toContain('port 17777');
	expect(message).toContain('http://localhost:18000');
});

test('no recorded daemon means spawning is allowed', () => {
	expect(
		describeRecordedDaemonConflict(
			{ pid: undefined, running: false, argv: undefined },
			'http://localhost:18000',
		),
	).toBeUndefined();
});
