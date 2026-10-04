import { afterEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { AcpAgent } from './acp-agent.ts';
import {
	createPiAcpConfig,
	getPiBinary,
	getPiConfigOptions,
	Pi,
	resolvePiBinary,
} from './pi.ts';
import { Settings } from './settings.ts';

const previousBinary = process.env.OAGENT_PI_BIN;
afterEach(() => {
	if (previousBinary === undefined) delete process.env.OAGENT_PI_BIN;
	else process.env.OAGENT_PI_BIN = previousBinary;
});

describe('Pi ACP backend', () => {
	test('resolves the adapter without launcher arguments', () => {
		delete process.env.OAGENT_PI_BIN;
		expect(getPiBinary()).toBe('pi-acp');
		process.env.OAGENT_PI_BIN = 'sh';
		expect(resolvePiBinary()).toBe(Bun.which('sh') ?? undefined);
		expect(createPiAcpConfig().args).toEqual([]);
	});
	test('uses model then thought_level config options', () => {
		expect(getPiConfigOptions('provider/model', 'off')).toEqual([
			{ configId: 'model', value: 'provider/model' },
			{ configId: 'thought_level', value: 'off' },
		]);
		expect(getPiConfigOptions(undefined, undefined)).toBeUndefined();
		expect(getPiConfigOptions(undefined, 'max')).toEqual([
			{ configId: 'thought_level', value: 'max' },
		]);
	});
	test('keeps thinking separate from agent modes and disables unsupported capabilities', async () => {
		const calls: Array<Parameters<AcpAgent['Service']['runTurn']>[0]> = [];
		const harness = await Effect.runPromise(
			Pi.make.pipe(
				Effect.provideService(AcpAgent, {
					runTurn: (input) => {
						calls.push(input);
						return Effect.succeed({
							sessionId: 'pi-session',
							text: 'OK',
							stopReason: 'end_turn',
						});
					},
					listModels: () => Effect.succeed([{ id: 'provider/model' }]),
					forkSession: () => Effect.die('Unexpected fork'),
					listSessionCatalog: () => Effect.die('Unexpected mode catalog'),
				}),
				Effect.provideService(Settings, {
					getHarnessEnv: () => ({}),
				} as unknown as Settings['Service']),
			),
		);
		expect(await Effect.runPromise(harness.listModels())).toEqual([
			{ id: 'provider/model' },
		]);
		expect(
			(await Effect.runPromise(harness.listModelEfforts())).map(
				(entry) => entry.value,
			),
		).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
		expect(await Effect.runPromise(harness.listAgentTargets())).toEqual([]);
		expect(harness.supportsModelSwitch).toBe(false);
		expect(harness).not.toHaveProperty('steer');
		expect(harness).not.toHaveProperty('forkSession');
		await Effect.runPromise(
			harness.runTurn({
				prompt: 'OK',
				cwd: '/tmp',
				sessionId: 'existing',
				model: 'provider/model',
				reasoningEffort: 'low',
			}),
		);
		expect(calls[0]).toMatchObject({
			sessionId: 'existing',
			model: undefined,
			reasoningEffort: undefined,
			configOptions: getPiConfigOptions('provider/model', 'low'),
		});
		expect(calls[0]?.mode).toBeUndefined();
	});
});
