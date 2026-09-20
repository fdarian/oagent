import { join } from 'node:path';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import {
	CurrentSession,
	DevSessions,
	getStickyPort,
	publishRunning,
} from 'devsess';
import { Effect } from 'effect';
import { FileSystem } from 'effect/FileSystem';
import { Command } from 'effect/unstable/cli';
import enginePackage from '../package.json' with { type: 'json' };
import { Engine } from '../src/server.ts';

const TESTER_SPACE_DIR = join(import.meta.dirname, '../../..', 'spaces/tester');

const writeDevConfigs = (url: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const mcpUrl = `${url}/mcp`;

		yield* fs.makeDirectory(TESTER_SPACE_DIR, { recursive: true });
		yield* fs.writeFileString(
			join(TESTER_SPACE_DIR, '.mcp.json'),
			`${JSON.stringify(
				{
					mcpServers: {
						'local-oagent': {
							type: 'http',
							url: mcpUrl,
						},
					},
				},
				null,
				'\t',
			)}\n`,
		);
		yield* fs.writeFileString(
			join(TESTER_SPACE_DIR, 'opencode.json'),
			`${JSON.stringify(
				{
					mcp: {
						servers: {
							'local-oagent': {
								type: 'remote',
								url: mcpUrl,
							},
						},
					},
				},
				null,
				'\t',
			)}\n`,
		);
	});

const engine = Command.make(enginePackage.name, {}, () =>
	Effect.gen(function* () {
		const session = yield* CurrentSession;
		yield* Effect.logInfo(`[dev] session: ${session.name}`);

		process.env.OAGENT_HOME_DIR = yield* session.path('.');
		process.env.OAGENT_LOG_DIR = yield* session.path('logs');

		const port = yield* getStickyPort(session);
		const url = `http://127.0.0.1:${port}`;
		yield* Effect.logInfo(`[dev] port: ${port} (${url})`);

		yield* writeDevConfigs(url);

		yield* publishRunning({ url });

		yield* Effect.gen(function* () {
			const service = yield* Engine;
			yield* service.startServer({
				port,
				serverInfo: { name: 'oagent', version: enginePackage.version },
			});
		}).pipe(Effect.provide(Engine.layer));
	}).pipe(Effect.provide(CurrentSession.layer)),
);

const program = Command.run({ version: enginePackage.version })(engine);

BunRuntime.runMain()(
	program.pipe(
		Effect.provide(DevSessions.layer),
		Effect.provide(BunServices.layer),
		Effect.scoped,
	),
);
