import fs from 'node:fs';
import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { ensureMacOs } from '#/lib/service/environment.ts';
import { bootoutService, SERVICE_LABEL } from '#/lib/service/launchctl.ts';
import { getServicePaths } from '#/lib/service/paths.ts';
import { removePlistFile } from '#/lib/service/plist.ts';
import { writeLines } from './shared.ts';

function runStop() {
	return Effect.gen(function* () {
		yield* ensureMacOs();
		const paths = yield* getServicePaths();
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

export const stop = Command.make('stop', {}, () => runStop()).pipe(
	Command.withDescription(
		'Stop and fully uninstall the launchd background service',
	),
);
