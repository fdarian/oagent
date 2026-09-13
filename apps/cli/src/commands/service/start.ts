import { getOagentLogsDir } from '@oagent/engine';
import { Effect } from 'effect';
import { Path } from 'effect/Path';
import { Command, Flag } from 'effect/unstable/cli';
import {
	ensureMacOs,
	getServiceStartCommand,
	validatePort,
} from '#/lib/service/environment.ts';
import {
	ensureServiceDirectories,
	getServicePaths,
} from '#/lib/service/paths.ts';
import { startManagedServer } from '#/lib/service/process.ts';
import { portOption, writeLines } from './shared.ts';

function getServeArgs(params: {
	port: number;
	portless: boolean;
	logFile: string;
}): ReadonlyArray<string> {
	const portlessArgs = params.portless ? ['--portless'] : [];
	return [
		'serve',
		'--port',
		String(params.port),
		...portlessArgs,
		'--log-file',
		params.logFile,
		'--log-level',
		'info',
	];
}

export const start = Command.make(
	'start',
	{
		port: portOption,
		portless: Flag.Boolean('portless').pipe(
			Flag.withDefault(false),
			Flag.withDescription('Register the server with the portless proxy'),
		),
	},
	(params) =>
		Effect.gen(function* () {
			yield* ensureMacOs();
			yield* validatePort(params.port);

			const startCommand = yield* getServiceStartCommand();
			const logDir = yield* getOagentLogsDir;
			const path = yield* Path;
			const paths = yield* getServicePaths();
			yield* ensureServiceDirectories(paths);

			const result = yield* startManagedServer({
				command: [
					...startCommand,
					...getServeArgs({
						port: params.port,
						portless: params.portless,
						logFile: path.join(logDir, 'oagent.jsonl'),
					}),
				],
				pidPath: paths.pidPath,
			});

			writeLines([
				result.started
					? 'oagent serve started in the background'
					: 'oagent serve is already running',
				`pid: ${result.pid}`,
				`port: ${params.port}`,
			]);
		}),
).pipe(Command.withDescription('Start oagent serve in the background'));
