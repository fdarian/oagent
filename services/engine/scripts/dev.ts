import * as fsAsync from 'node:fs/promises';
import { join } from 'node:path';
import * as cli from '@effect/cli';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { DevSessions, makeDevSessionsLayer } from '@oagent/common/dev-sessions';
import { Console, Effect, Layer } from 'effect';
import getPort from 'get-port';
import enginePackage from '../package.json' with { type: 'json' };
import { Jobs } from '../src/jobs.ts';
import { OpenCode } from '../src/opencode.ts';
import { createServer } from '../src/server.ts';

const REPO_ROOT = join(import.meta.dirname, '../../..');
const SESSIONS_DIR = join(REPO_ROOT, 'services/engine/.data/sessions');
const DEV_JSON_PATH = join(REPO_ROOT, 'services/engine/.data/dev.json');

const devCommand = cli.Command.make('dev', {}, () =>
	Effect.gen(function* () {
		const devSessions = yield* DevSessions;
		const session = yield* devSessions.getLatestOrCreate;
		yield* Console.log(`[engine] session: ${session.toString()}`);

		const dbPath = yield* session.path('sqlite.db');
		const devPortPath = yield* session.path('dev-port');

		const port = yield* Effect.promise(async () => {
			const preferred = await (async () => {
				try {
					const raw = await fsAsync.readFile(devPortPath, 'utf-8');
					const n = Number.parseInt(raw, 10);
					return Number.isNaN(n) ? undefined : n;
				} catch {
					return undefined;
				}
			})();
			const p = await getPort({
				port: preferred !== undefined ? [preferred] : undefined,
			});
			await fsAsync.writeFile(devPortPath, String(p));
			return p;
		});

		const url = `http://127.0.0.1:${port}`;

		yield* Effect.promise(async () => {
			const dir = join(REPO_ROOT, 'services/engine/.data');
			await fsAsync.mkdir(dir, { recursive: true });
			await fsAsync.writeFile(
				DEV_JSON_PATH,
				JSON.stringify({ port, url: `${url}/mcp` }),
			);
		});

		yield* Effect.addFinalizer(() =>
			Effect.promise(async () => {
				try {
					await fsAsync.unlink(DEV_JSON_PATH);
				} catch {
					// best-effort
				}
			}),
		);

		yield* Console.log(`[engine] port: ${port} (${url})`);

		process.env.OAGENT_DB_PATH = dbPath;

		yield* createServer({
			port,
			serverInfo: { name: 'oagent', version: enginePackage.version },
		});
	}),
);

const layerMain = Layer.mergeAll(
	Jobs.Default,
	OpenCode.Default,
	Layer.provide(makeDevSessionsLayer(SESSIONS_DIR), BunContext.layer),
	BunContext.layer,
).pipe(Layer.provideMerge(Layer.scope));

const main = cli.Command.run(devCommand, { name: 'dev', version: '0.0.1' });
main(process.argv).pipe(Effect.provide(layerMain), BunRuntime.runMain);
