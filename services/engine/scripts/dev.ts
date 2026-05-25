import { join } from 'node:path';
import { defineDevCli } from '@oagent/common';
import { Effect } from 'effect';
import enginePackage from '../package.json' with { type: 'json' };
import { Engine } from '../src/server.ts';

const REPO_ROOT = join(import.meta.dirname, '../../..');

const main = defineDevCli({
	name: enginePackage.name,
	dir: join(REPO_ROOT, 'services/engine'),
	run: ({ session, getStickyPort, setFile }) =>
		Effect.gen(function* () {
			const engine = yield* Engine;
			const s = yield* session;
			yield* Effect.logInfo(`[dev] session: ${s.name}`);

			process.env.OAGENT_DB_PATH = yield* s.path('sqlite.db');

			const port = yield* getStickyPort();
			const url = `http://127.0.0.1:${port}`;
			yield* Effect.logInfo(`[dev] port: ${port} (${url})`);

			yield* setFile({ url });
			yield* engine.startServer({
				port,
				serverInfo: { name: 'oagent', version: enginePackage.version },
			});
		}).pipe(Effect.provide(Engine.layer)),
});

main(process.argv);
