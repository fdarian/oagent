import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import { ensureMacOs } from '#/lib/service/environment.ts';
import { bootoutService, SERVICE_LABEL } from '#/lib/service/launchctl.ts';
import { getServicePaths } from '#/lib/service/paths.ts';
import { removePlistFile } from '#/lib/service/plist.ts';
import { stopManagedServer } from '#/lib/service/process.ts';
import { writeLines } from './shared.ts';

function runUninstall() {
	return Effect.gen(function* () {
		yield* ensureMacOs();

		const paths = yield* getServicePaths();
		const server = yield* stopManagedServer(paths.pidPath);
		const launchdStopped = yield* bootoutService(paths);
		yield* removePlistFile(paths.plistPath);

		writeLines([
			'service uninstalled',
			`label: ${SERVICE_LABEL}`,
			`service stopped: ${server.stopped || launchdStopped ? 'yes' : 'no'}`,
			'run at login: no',
			'plist removed',
		]);
	});
}

export const uninstall = Command.make('uninstall', {}, () =>
	runUninstall(),
).pipe(Command.withDescription('Uninstall the oagent login item'));
