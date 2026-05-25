import { Command, Options } from '@effect/cli';
import { Engine } from '@oagent/engine';
import { Effect } from 'effect';
import type { Version } from '#/lib/misc.ts';

const webFilemap = Effect.gen(function* () {
	let filemap: Record<string, string> | undefined;
	const mod = yield* Effect.tryPromise({
		// biome-ignore lint/suspicious/noTsIgnore: generated module missing in dev
		// @ts-ignore Generated at build time; missing in dev
		try: () =>
			import('../../.gen/web-ui.gen.ts') as Promise<{
				default?: Record<string, string>;
			}>,
		catch: () => undefined,
	});
	if (mod?.default !== undefined && typeof mod.default === 'object') {
		filemap = mod.default;
	}
	return filemap;
});

function runServe(params: { port: number; version: Version }) {
	return Effect.gen(function* () {
		const engine = yield* Engine;

		yield* engine.startServer({
			port: params.port,
			serverInfo: { name: 'oagent', version: params.version },
			filemap: yield* webFilemap,
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
		},
		({ port }) => runServe({ port, version }),
	);
