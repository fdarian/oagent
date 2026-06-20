import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { SERVICE_LABEL } from '#/lib/service/launchctl.ts';
import { loadServiceStatus } from '#/lib/service/lifecycle.ts';
import { writeLines } from './shared.ts';

function runStatus() {
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

export const status = Command.make('status', {}, () => runStatus()).pipe(
	Command.withDescription('Show launchd service status'),
);
