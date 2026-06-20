import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { ensureMacOs } from '#/lib/service/environment.ts';
import { bootoutService, SERVICE_LABEL } from '#/lib/service/launchctl.ts';
import { installAndBootstrap } from '#/lib/service/lifecycle.ts';
import { getServicePaths } from '#/lib/service/paths.ts';
import { portOption, writeLines } from './shared.ts';

function runRestart(port: number) {
	return Effect.gen(function* () {
		yield* ensureMacOs();

		const paths = yield* getServicePaths();
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

export const restart = Command.make('restart', { port: portOption }, (params) =>
	runRestart(params.port),
).pipe(
	Command.withDescription(
		'Stop, reinstall, and restart the launchd background service',
	),
);
