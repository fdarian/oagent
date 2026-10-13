import { Effect } from 'effect';
import { Command, Flag } from 'effect/cli';
import { disableIdleExit, requireServeArgv } from '#/lib/service/daemon.ts';
import {
	ensureMacOs,
	getServiceStartCommand,
	validatePort,
} from '#/lib/service/environment.ts';
import { ServiceError } from '#/lib/service/errors.ts';
import {
	ensureServiceDirectories,
	getServiceLogFile,
	getServicePaths,
} from '#/lib/service/paths.ts';
import {
	loadManagedServerStatus,
	startManagedServer,
} from '#/lib/service/process.ts';
import {
	describeDaemonMismatch,
	formatDaemonMismatchMessage,
} from '#/lib/service/serve-argv.ts';
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
			const logFile = yield* getServiceLogFile;
			const paths = yield* getServicePaths();
			yield* ensureServiceDirectories(paths);

			const running = yield* loadManagedServerStatus(paths.pidPath);
			if (running.running && running.pid !== undefined) {
				const argv = yield* requireServeArgv(running);
				const differences = describeDaemonMismatch(argv, {
					binary: startCommand,
					port: params.port,
					portless: params.portless,
				});
				if (differences.length > 0) {
					return yield* new ServiceError({
						message: formatDaemonMismatchMessage(running.pid, differences),
					});
				}

				if (argv.idleExit) {
					yield* disableIdleExit(argv);
					writeLines([
						`on-demand oagent serve (pid ${running.pid}) switched to service mode`,
						`pid: ${running.pid}`,
						`port: ${params.port}`,
					]);
					return;
				}
			}

			const result = yield* startManagedServer({
				command: [
					...startCommand,
					...getServeArgs({
						port: params.port,
						portless: params.portless,
						logFile,
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
