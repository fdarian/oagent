import { Command, Options } from '@effect/cli';
import { Engine } from '@oagent/engine';
import { Effect } from 'effect';
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
		Effect.logWarning('Web UI bundle not available, please run `bun --filter \'@oagent/cli\' build` first; serving without SPA', error),
	),
	Effect.orElseSucceed(() => undefined),
);

function runServe(params: {
	port: number;
	portless: boolean;
	version: Version;
}) {
	return Effect.gen(function* () {
		const engine = yield* Engine;

		yield* engine.startServer({
			port: params.port,
			serverInfo: { name: 'oagent', version: params.version },
			filemap: yield* webFilemap,
			portless: params.portless,
		});
	});
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
					'Register with portless proxy for https://oagent.localhost access',
				),
			),
		},
		({ port, portless }) => runServe({ port, portless, version }),
	);
