import * as fsAsync from 'node:fs/promises';
import { join } from 'node:path';
import * as cli from '@effect/cli';
import * as platform from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { DevSessions, makeDevSessionsLayer } from '@oagent/common/dev-sessions';
import { Console, Effect } from 'effect';
import getPort from 'get-port';

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

		yield* Console.log(`[engine] port: ${port} (${url})`);

		const child = platform.Command.make(
			'bun',
			'src/index.ts',
			'serve',
			'--port',
			String(port),
		).pipe(
			platform.Command.env({
				...process.env,
				OAGENT_DB_PATH: dbPath,
			}),
			platform.Command.stdin('inherit'),
			platform.Command.stdout('inherit'),
			platform.Command.stderr('inherit'),
		);

		return yield* Effect.scoped(
			Effect.gen(function* () {
				const childProcess = yield* platform.Command.start(child);

				yield* Effect.addFinalizer(() =>
					Effect.gen(function* () {
						yield* Effect.promise(async () => {
							try {
								await fsAsync.unlink(DEV_JSON_PATH);
							} catch {
								// best-effort cleanup
							}
						});
						yield* childProcess.kill().pipe(Effect.catchAll(() => Effect.void));
					}),
				);

				return yield* childProcess.exitCode;
			}),
		);
	}),
);

const main = cli.Command.run(devCommand, { name: 'dev', version: '0.0.1' });
main(process.argv).pipe(
	Effect.provide(makeDevSessionsLayer(SESSIONS_DIR)),
	Effect.provide(BunContext.layer),
	BunRuntime.runMain,
);
