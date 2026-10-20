import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Effect } from 'effect';
import { loadConfig } from './config.ts';

const previousHome = process.env.OAGENT_HOME_DIR;
// The environment is read once per process, so every test shares one home.
const home = mkdtempSync(join(tmpdir(), 'oagent-config-'));
const configPath = join(home, 'config.json');
process.env.OAGENT_HOME_DIR = home;

afterEach(() => {
	rmSync(configPath, { force: true });
});

afterAll(() => {
	rmSync(home, { recursive: true, force: true });
	if (previousHome === undefined) delete process.env.OAGENT_HOME_DIR;
	else process.env.OAGENT_HOME_DIR = previousHome;
});

const load = () =>
	Effect.runPromise(loadConfig().pipe(Effect.provide(BunServices.layer)));

describe('loadConfig', () => {
	test('holds Claude jobs for 30 minutes by default', async () => {
		expect((await load()).claudeBackgroundHoldMinutes).toBe(30);
	});

	test('reads the Claude background hold cap from the config file', async () => {
		writeFileSync(
			configPath,
			JSON.stringify({ claudeBackgroundHoldMinutes: 5 }),
		);

		expect((await load()).claudeBackgroundHoldMinutes).toBe(5);
	});

	test('rejects a non-positive cap', async () => {
		writeFileSync(
			configPath,
			JSON.stringify({ claudeBackgroundHoldMinutes: 0 }),
		);

		await expect(load()).rejects.toThrow();
	});
});
