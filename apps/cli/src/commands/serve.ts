import { acquireHttpListener, Engine, parseIdleDuration } from '@oagent/engine';
import { type Duration, Effect, Option } from 'effect';
import { Command, Flag } from 'effect/cli';
import { getLoggerLayer } from '#/lib/logging.ts';
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
	idleExit?: Duration.Duration;
}) {
	const baseProgram = Effect.gen(function* () {
		const listener =
			params.idleExit === undefined
				? undefined
				: yield* acquireHttpListener(params.port);
		yield* Effect.gen(function* () {
			const engine = yield* Engine;
			yield* engine.startServer({
				port: params.port,
				serverInfo: { name: 'oagent', version: params.version },
				filemap: yield* webFilemap,
				portless: params.portless,
				idleExit: params.idleExit,
				listener,
			});
		}).pipe(Effect.provide(Engine.layer));
	}).pipe(Effect.scoped);

	const loggerLayer = getLoggerLayer(params.logFile);

	return baseProgram.pipe(Effect.provide(loggerLayer));
}

export const serveCmd = (version: Version) =>
	Command.make(
		'serve',
		{
			idleExit: Flag.optional(Flag.String('idle-exit')),
			port: Flag.Int('port').pipe(
				Flag.withAlias('p'),
				Flag.withDefault(17_777),
				Flag.withDescription('Port to listen on (default: 17777)'),
			),
			portless: Flag.Boolean('portless').pipe(
				Flag.withDefault(false),
				Flag.withDescription(
					'Register with portless proxy for https://oagent.localhost access (also settable in $OAGENT_HOME_DIR/config.json, default ~/.config/oagent/config.json, via "portless": true)',
				),
			),
			logFile: Flag.optional(Flag.String('log-file')).pipe(
				Flag.withDescription(
					'Write Effect logs as JSONL to the given file instead of pretty console output',
				),
			),
		},
		(params) =>
			Effect.gen(function* () {
				const idleExit = Option.isSome(params.idleExit)
					? yield* parseIdleDuration(params.idleExit.value)
					: undefined;
				return yield* runServe({
					port: params.port,
					portless: params.portless,
					logFile: Option.getOrUndefined(params.logFile),
					version,
					idleExit,
				});
			}),
	);
