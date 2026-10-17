import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Duration, Effect, Exit, Schedule, Scope } from 'effect';
import { Claude } from './claude.ts';
import { Codex } from './codex.ts';
import { Cursor } from './cursor.ts';
import {
	CustomHarnessError,
	CustomHarnesses,
	makeCustomHarnesses,
	validateCustomHarnessId,
} from './custom-harnesses.ts';
import { Db } from './db/client.ts';
import { Grok } from './grok.ts';
import type { Harness } from './harness.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { OpenCode } from './opencode.ts';
import { Pi } from './pi.ts';
import { Settings } from './settings.ts';
import { createTestDatabase } from './test-database.ts';

const agentScript = fileURLToPath(
	new URL('./test-acp-agent.ts', import.meta.url),
);

function createServices(
	inlineIdleTimeToLive: Duration.Input = Duration.minutes(5),
) {
	const database = createTestDatabase();
	const dbService = {
		db: database.db,
		sqlite: database.sqlite,
	} as unknown as Db['Service'];
	const scope = Effect.runSync(Scope.make());
	const settings = Effect.runSync(
		Settings.make.pipe(Effect.provideService(Db, dbService)),
	);
	const customHarnesses = Effect.runSync(
		makeCustomHarnesses({ inlineIdleTimeToLive }).pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.provideService(Db, dbService),
			Effect.provideService(Settings, settings),
		),
	);
	return { database, settings, customHarnesses, scope };
}

const closeServices = (services: ReturnType<typeof createServices>) =>
	Scope.close(services.scope, Exit.succeed(undefined));

const input = (overrides: Partial<{ id: string; name: string }> = {}) => ({
	id: 'my-agent',
	name: 'My agent',
	binary: process.execPath,
	args: [agentScript],
	...overrides,
});

describe('custom harness id validation', () => {
	test.each(['a', 'my-agent', 'agent2', `a${'b'.repeat(31)}`])(
		'accepts %s',
		async (id) => {
			await Effect.runPromise(validateCustomHarnessId(id));
		},
	);

	test.each([
		'',
		'1agent',
		'-agent',
		'My-Agent',
		'my_agent',
		'my agent',
		'my:agent',
		'my#agent',
		`a${'b'.repeat(32)}`,
	])('rejects the malformed id %p', async (id) => {
		const error = await Effect.runPromise(
			validateCustomHarnessId(id).pipe(Effect.flip),
		);
		expect(error).toBeInstanceOf(CustomHarnessError);
		expect(error.code).toBe('INVALID_ID');
	});

	test.each(['opencode', 'cursor', 'grok', 'codex', 'claude', 'pi', 'acp'])(
		'rejects the reserved id %s',
		async (id) => {
			const error = await Effect.runPromise(
				validateCustomHarnessId(id).pipe(Effect.flip),
			);
			expect(error.code).toBe('RESERVED_ID');
		},
	);
});

describe('CustomHarnesses CRUD', () => {
	test('creates, lists, updates and deletes a definition', async () => {
		const services = createServices();
		const customHarnesses = services.customHarnesses;
		const created = await Effect.runPromise(customHarnesses.create(input()));
		expect(created).toMatchObject({
			id: 'my-agent',
			name: 'My agent',
			binary: process.execPath,
			args: [agentScript],
		});
		expect(customHarnesses.list().map((entry) => entry.id)).toEqual([
			'my-agent',
		]);

		const updated = await Effect.runPromise(
			customHarnesses.update({
				...input(),
				name: 'Renamed',
				args: [agentScript, '--flag'],
			}),
		);
		expect(updated.name).toBe('Renamed');
		expect(updated.args).toEqual([agentScript, '--flag']);
		expect(updated.createdAt.getTime()).toBe(created.createdAt.getTime());

		services.settings.setHarnessEnv('my-agent', { KEY: 'value' });
		await Effect.runPromise(customHarnesses.remove('my-agent'));
		expect(customHarnesses.list()).toEqual([]);
		expect(services.settings.getHarnessEnv('my-agent')).toEqual({});
		await Effect.runPromise(closeServices(services));
	});

	test('rejects duplicate, reserved and blank definitions', async () => {
		const services = createServices();
		const customHarnesses = services.customHarnesses;
		await Effect.runPromise(customHarnesses.create(input()));
		const duplicate = await Effect.runPromise(
			customHarnesses.create(input()).pipe(Effect.flip),
		);
		expect(duplicate).toMatchObject({ code: 'ALREADY_EXISTS' });
		const reserved = await Effect.runPromise(
			customHarnesses.create(input({ id: 'claude' })).pipe(Effect.flip),
		);
		expect(reserved).toMatchObject({ code: 'RESERVED_ID' });
		const blankName = await Effect.runPromise(
			customHarnesses
				.create(input({ id: 'other', name: '  ' }))
				.pipe(Effect.flip),
		);
		expect(blankName).toMatchObject({ code: 'INVALID_DEFINITION' });
		const blankBinary = await Effect.runPromise(
			customHarnesses
				.create({ ...input({ id: 'other' }), binary: ' ' })
				.pipe(Effect.flip),
		);
		expect(blankBinary).toMatchObject({ code: 'INVALID_DEFINITION' });
	});

	test('updating or deleting an unknown id fails with UnknownHarness', async () => {
		const customHarnesses = createServices().customHarnesses;
		const update = await Effect.runPromise(
			customHarnesses.update(input()).pipe(Effect.flip),
		);
		expect(update).toMatchObject({
			_tag: 'UnknownHarness',
			harnessId: 'my-agent',
		});
		const remove = await Effect.runPromise(
			customHarnesses.remove('my-agent').pipe(Effect.flip),
		);
		expect(remove).toMatchObject({ _tag: 'UnknownHarness' });
	});
});

describe('CustomHarnesses instances', () => {
	test('caches a harness per definition and rebuilds it on update', async () => {
		const services = createServices();
		const customHarnesses = services.customHarnesses;
		await Effect.runPromise(customHarnesses.create(input()));
		const first = await Effect.runPromise(customHarnesses.resolve('my-agent'));
		const again = await Effect.runPromise(customHarnesses.resolve('my-agent'));
		expect(again).toBe(first);
		expect(first.backend).toBe('my-agent');
		expect(first.supportsModelSwitch).toBe(false);
		expect(first.resolveBinary()).toBe(process.execPath);

		await Effect.runPromise(
			customHarnesses.update({ ...input(), name: 'Renamed' }),
		);
		const rebuilt = await Effect.runPromise(
			customHarnesses.resolve('my-agent'),
		);
		expect(rebuilt).not.toBe(first);
	});

	test('resolving a deleted or never-defined id fails', async () => {
		const customHarnesses = createServices().customHarnesses;
		await Effect.runPromise(customHarnesses.create(input()));
		await Effect.runPromise(customHarnesses.remove('my-agent'));
		const error = await Effect.runPromise(
			customHarnesses.resolve('my-agent').pipe(Effect.flip),
		);
		expect(error).toMatchObject({ _tag: 'UnknownHarness' });
		expect(error.message).toContain('no longer exists');
		const malformed = await Effect.runPromise(
			customHarnesses.resolve('Not A Slug').pipe(Effect.flip),
		);
		expect(malformed).toMatchObject({ _tag: 'UnknownHarness' });
	});

	test('a custom harness runs a turn and has no efforts or agent targets', async () => {
		const services = createServices();
		const customHarnesses = services.customHarnesses;
		await Effect.runPromise(customHarnesses.create(input()));
		const harness = await Effect.runPromise(
			customHarnesses.resolve('my-agent'),
		);
		const result = await Effect.runPromise(
			harness.runTurn({
				prompt: 'pid?',
				cwd: process.cwd(),
				reasoningEffort: 'high',
			}),
		);
		expect(Number(result.text)).toBeGreaterThan(0);
		expect(
			await Effect.runPromise(harness.listModelEfforts('any-model')),
		).toEqual([]);
		expect(await Effect.runPromise(harness.listAgentTargets())).toEqual([]);
		expect(await Effect.runPromise(harness.check())).toMatchObject({
			backend: 'my-agent',
			ok: true,
		});
		await Effect.runPromise(closeServices(services));
	});

	test('steer and fork fail with typed errors when the adapter lacks the capability', async () => {
		const services = createServices();
		await Effect.runPromise(services.customHarnesses.create(input()));
		services.settings.setHarnessEnv('my-agent', { TEST_ACP_NO_STEERING: '1' });
		const harness = await Effect.runPromise(
			services.customHarnesses.resolve('my-agent'),
		);
		const sessionId = Promise.withResolvers<string>();
		const turn = Effect.runPromise(
			harness.runTurn({
				prompt: 'wait-for-steer',
				cwd: process.cwd(),
				onSessionId: sessionId.resolve,
			}),
		).catch(() => undefined);
		const id = await sessionId.promise;
		const steer = harness.steer;
		const fork = harness.forkSession;
		if (steer === undefined || fork === undefined) {
			throw new Error('custom harness must expose steer and forkSession');
		}
		const steerError = await Effect.runPromise(
			steer({ sessionId: id, text: 'hello' }).pipe(
				Effect.retry({
					while: (error) => error.code === 'NOT_RUNNING',
					times: 20,
					schedule: Schedule.spaced('50 millis'),
				}),
				Effect.flip,
			),
		);
		expect(steerError).toMatchObject({
			_tag: 'HarnessSteerError',
			code: 'UNSUPPORTED_VERSION',
		});
		const forkError = await Effect.runPromise(
			fork({ sessionId: id, cwd: process.cwd() }).pipe(Effect.flip),
		);
		expect(forkError).toMatchObject({ _tag: 'AcpForkNotSupportedError' });
		await Effect.runPromise(closeServices(services));
		await turn;
	});
});

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const waitUntil = async (condition: () => boolean) => {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (condition()) return;
		await Bun.sleep(50);
	}
	throw new Error('Timed out waiting for condition');
};

const agentLauncher = () => {
	const directory = mkdtempSync(join(tmpdir(), 'oagent-launcher-'));
	const launcher = join(directory, 'agent.sh');
	writeFileSync(
		launcher,
		`#!/bin/sh\nexec "${process.execPath}" "${agentScript}" "$@"\n`,
	);
	chmodSync(launcher, 0o755);
	return launcher;
};

type TestHarness = Harness;

const pidOf = async (harness: TestHarness) =>
	Number(
		(
			await Effect.runPromise(
				harness.runTurn({ prompt: 'pid?', cwd: process.cwd() }),
			)
		).text,
	);

/** Starts a turn that stays in flight until `finish` steers it. */
const startHeldTurn = async (harness: TestHarness) => {
	const sessionId = Promise.withResolvers<string>();
	const turn = Effect.runPromise(
		harness.runTurn({
			prompt: 'wait-for-steer',
			cwd: process.cwd(),
			onSessionId: sessionId.resolve,
		}),
	);
	const id = await sessionId.promise;
	const steer = harness.steer;
	if (steer === undefined) throw new Error('harness must expose steer');
	return {
		turn,
		finish: () =>
			Effect.runPromise(
				steer({ sessionId: id, text: 'done' }).pipe(
					Effect.retry({
						while: (error) => error.code === 'NOT_RUNNING',
						times: 20,
						schedule: Schedule.spaced('50 millis'),
					}),
				),
			),
	};
};

describe('CustomHarnesses retirement', () => {
	test('an edit during a running turn lets it finish, then a new turn uses the new binary', async () => {
		const services = createServices();
		const customHarnesses = services.customHarnesses;
		await Effect.runPromise(customHarnesses.create(input()));
		const oldHarness = await Effect.runPromise(
			customHarnesses.resolve('my-agent'),
		);
		const oldPid = await pidOf(oldHarness);
		const held = await startHeldTurn(oldHarness);

		const launcher = agentLauncher();
		await Effect.runPromise(
			customHarnesses.update({ ...input(), binary: launcher, args: [] }),
		);
		expect(isAlive(oldPid)).toBe(true);

		const newHarness = await Effect.runPromise(
			customHarnesses.resolve('my-agent'),
		);
		expect(newHarness).not.toBe(oldHarness);
		expect(newHarness.resolveBinary()).toBe(launcher);
		const newPid = await pidOf(newHarness);
		expect(newPid).not.toBe(oldPid);
		expect(isAlive(oldPid)).toBe(true);

		await held.finish();
		const finished = await held.turn;
		expect(finished.text).toBe('steered:done');
		await waitUntil(() => !isAlive(oldPid));
		expect(isAlive(newPid)).toBe(true);
		await Effect.runPromise(closeServices(services));
		await waitUntil(() => !isAlive(newPid));
	});

	test('an edit with no turn in flight stops the old subprocess right away', async () => {
		const services = createServices();
		await Effect.runPromise(services.customHarnesses.create(input()));
		const harness = await Effect.runPromise(
			services.customHarnesses.resolve('my-agent'),
		);
		const pid = await pidOf(harness);
		await Effect.runPromise(
			services.customHarnesses.update({ ...input(), name: 'Renamed' }),
		);
		await waitUntil(() => !isAlive(pid));
		await Effect.runPromise(closeServices(services));
	});

	test('deleting during a running turn lets it finish, then the subprocess exits', async () => {
		const services = createServices();
		const customHarnesses = services.customHarnesses;
		await Effect.runPromise(customHarnesses.create(input()));
		const harness = await Effect.runPromise(
			customHarnesses.resolve('my-agent'),
		);
		const pid = await pidOf(harness);
		const held = await startHeldTurn(harness);

		await Effect.runPromise(customHarnesses.remove('my-agent'));
		expect(isAlive(pid)).toBe(true);
		const unknown = await Effect.runPromise(
			customHarnesses.resolve('my-agent').pipe(Effect.flip),
		);
		expect(unknown).toMatchObject({ _tag: 'UnknownHarness' });

		await held.finish();
		expect((await held.turn).text).toBe('steered:done');
		await waitUntil(() => !isAlive(pid));
		await Effect.runPromise(closeServices(services));
	});

	test('a stale harness reference fails with a typed error once its subprocess is closed', async () => {
		const services = createServices();
		await Effect.runPromise(services.customHarnesses.create(input()));
		const stale = await Effect.runPromise(
			services.customHarnesses.resolve('my-agent'),
		);
		await Effect.runPromise(services.customHarnesses.remove('my-agent'));
		const error = await Effect.runPromise(
			stale.runTurn({ prompt: 'pid?', cwd: process.cwd() }).pipe(Effect.flip),
		);
		expect(error).toMatchObject({ _tag: 'AcpSessionError' });
		expect(error.message).toContain('changed or removed');
		await Effect.runPromise(closeServices(services));
	});
});

describe('CustomHarnesses inline eviction', () => {
	const command = { binary: process.execPath, args: [agentScript] };

	test('an idle inline instance is closed and evicted after the TTL', async () => {
		const services = createServices(Duration.millis(200));
		const first = await Effect.runPromise(
			services.customHarnesses.resolveInline(command),
		);
		const pid = await pidOf(first);
		await Bun.sleep(100);
		expect(isAlive(pid)).toBe(true);
		await waitUntil(() => !isAlive(pid));
		const second = await Effect.runPromise(
			services.customHarnesses.resolveInline(command),
		);
		expect(second).not.toBe(first);
		await Effect.runPromise(closeServices(services));
	});

	test('a use outlasting the TTL keeps the instance, and the idle window restarts after it', async () => {
		const services = createServices(Duration.millis(300));
		const harness = await Effect.runPromise(
			services.customHarnesses.resolveInline(command),
		);
		const pid = await pidOf(harness);
		const held = await startHeldTurn(harness);
		await Bun.sleep(700);
		expect(isAlive(pid)).toBe(true);
		expect(
			await Effect.runPromise(services.customHarnesses.resolveInline(command)),
		).toBe(harness);

		await held.finish();
		await held.turn;
		await Bun.sleep(100);
		expect(isAlive(pid)).toBe(true);
		await waitUntil(() => !isAlive(pid));
		await Effect.runPromise(closeServices(services));
	});

	test('a new use inside the idle window cancels the eviction', async () => {
		const services = createServices(Duration.millis(400));
		const harness = await Effect.runPromise(
			services.customHarnesses.resolveInline(command),
		);
		const pid = await pidOf(harness);
		await Bun.sleep(250);
		expect(await pidOf(harness)).toBe(pid);
		await Bun.sleep(250);
		expect(isAlive(pid)).toBe(true);
		await waitUntil(() => !isAlive(pid));
		await Effect.runPromise(closeServices(services));
	});
});

describe('HarnessRegistry.resolve', () => {
	const stub = (backend: string) => ({ backend }) as never;

	test('resolves builtins directly and custom ids through CustomHarnesses', async () => {
		const services = createServices();
		await Effect.runPromise(services.customHarnesses.create(input()));
		const registry = await Effect.runPromise(
			HarnessRegistry.make.pipe(
				Effect.provideService(
					OpenCode,
					stub('opencode') as OpenCode['Service'],
				),
				Effect.provideService(Cursor, stub('cursor') as Cursor['Service']),
				Effect.provideService(Grok, stub('grok') as Grok['Service']),
				Effect.provideService(Codex, stub('codex') as Codex['Service']),
				Effect.provideService(Claude, stub('claude') as Claude['Service']),
				Effect.provideService(Pi, stub('pi') as Pi['Service']),
				Effect.provideService(CustomHarnesses, services.customHarnesses),
			),
		);

		const builtin = await Effect.runPromise(registry.resolve('claude'));
		expect(builtin.backend).toBe('claude');
		const custom = await Effect.runPromise(registry.resolve('my-agent'));
		expect(custom.backend).toBe('my-agent');
		const listed = await Effect.runPromise(registry.list());
		expect(listed.map((harness) => harness.backend)).toEqual([
			'opencode',
			'cursor',
			'grok',
			'codex',
			'claude',
			'pi',
			'my-agent',
		]);
		await closeServices(services).pipe(Effect.runPromise);
	});

	test('an unknown id fails with UnknownHarness', async () => {
		const services = createServices();
		const registry = await Effect.runPromise(
			HarnessRegistry.make.pipe(
				Effect.provideService(
					OpenCode,
					stub('opencode') as OpenCode['Service'],
				),
				Effect.provideService(Cursor, stub('cursor') as Cursor['Service']),
				Effect.provideService(Grok, stub('grok') as Grok['Service']),
				Effect.provideService(Codex, stub('codex') as Codex['Service']),
				Effect.provideService(Claude, stub('claude') as Claude['Service']),
				Effect.provideService(Pi, stub('pi') as Pi['Service']),
				Effect.provideService(CustomHarnesses, services.customHarnesses),
			),
		);
		const error = await Effect.runPromise(
			registry.resolve('missing').pipe(Effect.flip),
		);
		expect(error).toMatchObject({
			_tag: 'UnknownHarness',
			harnessId: 'missing',
		});
	});
});
