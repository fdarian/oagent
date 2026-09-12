import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import { SERVICE_LABEL } from '#/lib/service/launchctl.ts';
import { loadServiceStatus } from '#/lib/service/lifecycle.ts';
import { writeLines } from './shared.ts';

function runStatus() {
	return Effect.gen(function* () {
		const status = yield* loadServiceStatus();

		if (!status.installed) {
			const runningLine =
				status.pid === undefined
					? 'running: no'
					: `running: yes (pid ${status.pid})`;
			writeLines([
				`service: ${SERVICE_LABEL}`,
				'installed: no',
				'run at login: no',
				'loaded: no',
				runningLine,
				'binary: not installed',
				`plist: ${status.paths.plistPath}`,
			]);
			return;
		}

		const runningLine =
			status.pid !== undefined
				? `running: yes (pid ${status.pid})`
				: 'running: no';

		writeLines([
			`service: ${SERVICE_LABEL}`,
			'installed: yes',
			`run at login: ${status.runAtLoad ? 'yes' : 'no'}`,
			`loaded: ${status.loaded ? 'yes' : 'no'}`,
			runningLine,
			`binary: ${status.binaryPath}`,
			`port: ${status.port}`,
			`plist: ${status.paths.plistPath}`,
			`jsonl log: ${status.paths.jsonlLogPath}`,
		]);
	});
}

export const status = Command.make('status', {}, () => runStatus()).pipe(
	Command.withDescription('Show login item and server status'),
);
