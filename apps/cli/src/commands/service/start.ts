import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { ensureMacOs } from '#/lib/service/environment.ts';
import { isServiceLoaded, SERVICE_LABEL } from '#/lib/service/launchctl.ts';
import { installAndBootstrap } from '#/lib/service/lifecycle.ts';
import { portOption, writeLines } from './shared.ts';

function runStart(port: number) {
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

export const start = Command.make('start', { port: portOption }, (params) =>
	runStart(params.port),
).pipe(
	Command.withDescription(
		'Install and start the launchd background service (no-op if already running)',
	),
);
