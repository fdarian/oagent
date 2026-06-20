import fs from 'node:fs';
import { Command, Options } from '@effect/cli';
import { Effect } from 'effect';
import type { Version } from '#/lib/misc.ts';
import { ensureMacOs } from '#/lib/service/environment.ts';
import {
	bootoutService,
	isServiceLoaded,
	SERVICE_LABEL,
} from '#/lib/service/launchctl.ts';
import {
	installAndBootstrap,
	loadServiceStatus,
} from '#/lib/service/lifecycle.ts';
import { getServicePaths } from '#/lib/service/paths.ts';
import { removePlistFile } from '#/lib/service/plist.ts';

function writeLines(lines: ReadonlyArray<string>): void {
	process.stdout.write(`${lines.join('\n')}\n`);
}

function runStart(port: number): Effect.Effect<void, Error> {
	return Effect.gen(function* () {
		yield* ensureMacOs();

		const loaded = yield* isServiceLoaded();
		if (loaded) {
			writeLines([
				'service already started',
				`label: ${SERVICE_LABEL}`,
				'hint: run `oagent service restart` to apply changes',
			]);
			return;
		}

		const result = yield* installAndBootstrap(port);

		writeLines([
			'service started',
			`label: ${SERVICE_LABEL}`,
			`port: ${result.port}`,
			`plist: ${result.paths.plistPath}`,
			`jsonl log: ${result.paths.jsonlLogPath}`,
		]);
	});
}

function runRestart(port: number): Effect.Effect<void, Error> {
	return Effect.gen(function* () {
		yield* ensureMacOs();

		const paths = getServicePaths();
		yield* bootoutService(paths);

		const result = yield* installAndBootstrap(port);

		writeLines([
			'service restarted',
			`label: ${SERVICE_LABEL}`,
			`port: ${result.port}`,
			`plist: ${result.paths.plistPath}`,
			`jsonl log: ${result.paths.jsonlLogPath}`,
		]);
	});
}

function runStop(): Effect.Effect<void, Error> {
	return Effect.gen(function* () {
		yield* ensureMacOs();
		const paths = getServicePaths();
		if (!fs.existsSync(paths.plistPath)) {
			process.stdout.write('not installed (run `oagent service start`)\n');
			return;
		}

		yield* bootoutService(paths);
		yield* removePlistFile(paths.plistPath);

		writeLines([
			'service stopped',
			`label: ${SERVICE_LABEL}`,
			'plist removed (service will not relaunch on next login)',
		]);
	});
}

function runStatus(): Effect.Effect<void, Error> {
	return Effect.gen(function* () {
		const status = yield* loadServiceStatus();

		if (!status.installed) {
			process.stdout.write('not installed (run `oagent service start`)\n');
			return;
		}

		const runningLine =
			status.loaded && status.pid !== undefined
				? `running: yes (pid ${status.pid})`
				: 'running: no';

		writeLines([
			`service: ${SERVICE_LABEL}`,
			'installed: yes',
			`loaded: ${status.loaded ? 'yes' : 'no'}`,
			runningLine,
			`port: ${status.port}`,
			`plist: ${status.paths.plistPath}`,
			`jsonl log: ${status.paths.jsonlLogPath}`,
		]);
	});
}

export const serviceCmd = (_version: Version) => {
	const portOption = Options.integer('port').pipe(
		Options.withDefault(17_777),
		Options.withDescription('Port to run the background service on'),
	);

	const start = Command.make('start', { port: portOption }, (params) =>
		runStart(params.port),
	).pipe(
		Command.withDescription(
			'Install and start the launchd background service (no-op if already running)',
		),
	);

	const restart = Command.make('restart', { port: portOption }, (params) =>
		runRestart(params.port),
	).pipe(
		Command.withDescription(
			'Stop, reinstall, and restart the launchd background service',
		),
	);

	const status = Command.make('status', {}, () => runStatus()).pipe(
		Command.withDescription('Show launchd service status'),
	);

	const stop = Command.make('stop', {}, () => runStop()).pipe(
		Command.withDescription(
			'Stop and fully uninstall the launchd background service',
		),
	);

	return Command.make('service').pipe(
		Command.withDescription('Manage the macOS launchd background service'),
		Command.withSubcommands([start, restart, status, stop]),
	);
};
