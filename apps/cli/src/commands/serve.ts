import fs from 'node:fs';
import path from 'node:path';
import { Command, Options } from '@effect/cli';
import { Engine } from '@oagent/engine';
import { Effect, Logger, Option } from 'effect';
import type { Version } from '#/lib/misc.ts';

const webFilemap = Effect.tryPromise(
	() =>
		// biome-ignore lint/suspicious/noTsIgnore: generated module missing in dev
		// @ts-ignore Generated at build time; missing in dev
		import('../../.gen/web-ui.gen.ts') as Promise<{
			default?: Record<string, string>;
		}>,
).pipe(
	Effect.map((mod) => mod.default),
	Effect.tapError((error) =>
		Effect.logWarning(
			"Web UI bundle not available, please run `bun --filter '@oagent/cli' build` first; serving without SPA",
			error,
		),
	),
	Effect.orElseSucceed(() => undefined),
);

function runServe(params: {
	port: number;
	portless: boolean;
	logFile: string | undefined;
	version: Version;
}) {
	const baseProgram = Effect.gen(function* () {
		const engine = yield* Engine;

		yield* engine.startServer({
			port: params.port,
			serverInfo: { name: 'oagent', version: params.version },
			filemap: yield* webFilemap,
			portless: params.portless,
		});
	}).pipe(Effect.provide(Engine.layer));

	const loggerLayer = getLoggerLayer(params.logFile);

	return baseProgram.pipe(Effect.provide(loggerLayer));
}

function getLoggerLayer(logFile: string | undefined) {
	if (logFile !== undefined) {
		const resolvedPath = path.resolve(logFile);
		const logDir = path.dirname(resolvedPath);
		fs.mkdirSync(logDir, { recursive: true });
		const fileLogger = Logger.make((options) => {
			const line = Logger.jsonLogger.log(options);
			fs.appendFileSync(resolvedPath, `${line}\n`);
		});
		return Logger.replace(Logger.defaultLogger, fileLogger);
	}
	return Logger.pretty;
}

export const serveCmd = (version: Version) =>
	Command.make(
		'serve',
		{
			port: Options.integer('port').pipe(
				Options.withAlias('p'),
				Options.withDefault(17_777),
				Options.withDescription('Port to listen on (default: 17777)'),
			),
			portless: Options.boolean('portless').pipe(
				Options.withDefault(false),
				Options.withDescription(
					'Register with portless proxy for https://oagent.localhost access (also settable in ~/.config/oagent/config.json via "portless": true)',
				),
			),
			logFile: Options.optional(Options.text('log-file')).pipe(
				Options.withDescription(
					'Write Effect logs as JSONL to the given file instead of pretty console output',
				),
			),
		},
		(params) =>
			runServe({
				port: params.port,
				portless: params.portless,
				logFile: Option.getOrUndefined(params.logFile),
				version,
			}),
	);
