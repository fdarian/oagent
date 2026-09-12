import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import {
	ensureMacOs,
	getCallerPath,
	getServiceBinaryPath,
	validatePort,
} from '#/lib/service/environment.ts';
import { bootoutService, SERVICE_LABEL } from '#/lib/service/launchctl.ts';
import { installAndBootstrap } from '#/lib/service/lifecycle.ts';
import { getServicePaths } from '#/lib/service/paths.ts';
import { stopManagedServer } from '#/lib/service/process.ts';
import { portOption, writeLines } from './shared.ts';

function runInstall(port: number) {
	return Effect.gen(function* () {
		yield* ensureMacOs();
		yield* validatePort(port);
		yield* getServiceBinaryPath();
		yield* getCallerPath();

		const paths = yield* getServicePaths();
		yield* stopManagedServer(paths.pidPath);
		yield* bootoutService(paths);

		const result = yield* installAndBootstrap(port);

		writeLines([
			'service installed',
			`label: ${SERVICE_LABEL}`,
			'run at login: yes',
			`binary: ${result.binaryPath}`,
			`port: ${result.port}`,
			`plist: ${result.paths.plistPath}`,
			`jsonl log: ${result.paths.jsonlLogPath}`,
		]);
	});
}

export const install = Command.make('install', { port: portOption }, (params) =>
	runInstall(params.port),
).pipe(Command.withDescription('Install oagent to start at login'));
