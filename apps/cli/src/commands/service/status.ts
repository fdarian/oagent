import { Effect } from 'effect';
import { Command } from 'effect/cli';
import { SERVICE_LABEL } from '#/lib/service/launchctl.ts';
import { type DaemonMode, loadServiceStatus } from '#/lib/service/lifecycle.ts';
import { writeLines } from './shared.ts';

function runningBinaryLine(binaryPath: string | undefined): string {
	return binaryPath === undefined
		? 'running binary: not running'
		: `running binary: ${binaryPath}`;
}

function runningLine(
	pid: number | undefined,
	mode: DaemonMode | undefined,
): string {
	if (pid === undefined) {
		return 'running: no';
	}
	switch (mode) {
		case 'on-demand':
			return `running: yes (on-demand, pid ${pid})`;
		case 'not-responding':
			return `running: yes (pid ${pid}, not responding)`;
		default:
			return `running: yes (pid ${pid})`;
	}
}

function runStatus() {
	return Effect.gen(function* () {
		const status = yield* loadServiceStatus();

		if (!status.installed) {
			writeLines([
				`service: ${SERVICE_LABEL}`,
				'installed: no',
				'run at login: no',
				'loaded: no',
				runningLine(status.pid, status.mode),
				'binary: not installed',
				runningBinaryLine(status.runningBinaryPath),
				`plist: ${status.paths.plistPath}`,
			]);
			return;
		}

		writeLines([
			`service: ${SERVICE_LABEL}`,
			'installed: yes',
			`run at login: ${status.runAtLoad ? 'yes' : 'no'}`,
			`loaded: ${status.loaded ? 'yes' : 'no'}`,
			runningLine(status.pid, status.mode),
			`binary: ${status.binaryPath}`,
			runningBinaryLine(status.runningBinaryPath),
			`port: ${status.port}`,
			`plist: ${status.paths.plistPath}`,
		]);
	});
}

export const status = Command.make('status', {}, () => runStatus()).pipe(
	Command.withDescription('Show login item and server status'),
);
