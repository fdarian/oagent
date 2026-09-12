import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import { ensureMacOs } from '#/lib/service/environment.ts';
import { bootoutService, SERVICE_LABEL } from '#/lib/service/launchctl.ts';
import { getServicePaths } from '#/lib/service/paths.ts';
import { stopManagedServer } from '#/lib/service/process.ts';
import { writeLines } from './shared.ts';

function runStop() {
	return Effect.gen(function* () {
		yield* ensureMacOs();
		const paths = yield* getServicePaths();
		const launchdStopped = yield* bootoutService(paths);
		const server = yield* stopManagedServer(paths.pidPath);
		const wasRunning = server.stopped || launchdStopped;

		writeLines([
			wasRunning ? 'service stopped' : 'service was not running',
			`label: ${SERVICE_LABEL}`,
			`plist retained: ${paths.plistPath}`,
			'run `oagent service uninstall` to remove the login item',
		]);
	});
}

export const stop = Command.make('stop', {}, () => runStop()).pipe(
	Command.withDescription('Stop the running oagent server'),
);
