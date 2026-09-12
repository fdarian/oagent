import { Effect, Option } from 'effect';
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
	logFile: string | undefined;
	port: number;
	portless: boolean;
}): ReadonlyArray<string> {
	const portlessArgs = params.portless ? ['--portless'] : [];
	const logFileArgs =
		params.logFile === undefined ? [] : ['--log-file', params.logFile];
	return [
		'serve',
		'--port',
		String(params.port),
		...portlessArgs,
		...logFileArgs,
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
		logFile: Flag.optional(Flag.String('log-file')).pipe(
			Flag.withDescription(
				'Write Effect logs as JSONL to the given file instead of pretty console output',
			),
		),
	},
	(params) =>
		Effect.gen(function* () {
			yield* ensureMacOs();
			yield* validatePort(params.port);

			const startCommand = yield* getServiceStartCommand();
			const paths = yield* getServicePaths();
			yield* ensureServiceDirectories(paths);

			const result = yield* startManagedServer({
				command: [
					...startCommand,
					...getServeArgs({
						logFile: Option.getOrUndefined(params.logFile),
						port: params.port,
						portless: params.portless,
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
