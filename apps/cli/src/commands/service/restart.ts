import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import { ensureMacOs } from '#/lib/service/environment.ts';
import { bootoutService, SERVICE_LABEL } from '#/lib/service/launchctl.ts';
import { installAndBootstrap } from '#/lib/service/lifecycle.ts';
import { getServicePaths } from '#/lib/service/paths.ts';
import { stopManagedServer } from '#/lib/service/process.ts';
import { portOption, writeLines } from './shared.ts';

function runRestart(port: number) {
	return Effect.gen(function* () {
		yield* ensureMacOs();

		const paths = yield* getServicePaths();
		yield* bootoutService(paths);
		yield* stopManagedServer(paths.pidPath);

		const result = yield* installAndBootstrap(port);

		writeLines([
			'service restarted',
			`label: ${SERVICE_LABEL}`,
			'run at login: yes',
			`binary: ${result.binaryPath}`,
			`port: ${result.port}`,
			`plist: ${result.paths.plistPath}`,
		]);
	});
}

export const restart = Command.make('restart', { port: portOption }, (params) =>
	runRestart(params.port),
).pipe(
	Command.withDescription('Stop and restart the installed launchd login item'),
);
