import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import {
	awaitRunning,
	CurrentSession,
	DevSessions,
	runManagedSubprocess,
} from 'devsess';
import { Effect } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';
import webPackage from '../package.json' with { type: 'json' };

const web = Command.make(
	webPackage.name,
	{
		local: Flag.String('local').pipe(
			Flag.withDefault(''),
			Flag.withDescription('Use a local engine service (e.g., "engine")'),
		),
	},
	(opts) =>
		Effect.gen(function* () {
			const session = yield* CurrentSession;
			yield* Effect.logInfo(`[dev] session: ${session.name}`);

			const engineUrl = yield* Effect.gen(function* () {
				if (opts.local === 'engine') {
					const engine = yield* awaitRunning<{ url: string }>('@oagent/engine');
					yield* Effect.logInfo(`[dev] using local engine url: ${engine.url}`);
					return engine.url;
				}

				const engineUrl = 'http://localhost:17777';
				yield* Effect.logInfo(`[dev] using default engine url: ${engineUrl}`);
				return engineUrl;
			});

			yield* runManagedSubprocess('pnpm', ['vite'], {
				env: { ENGINE_URL: engineUrl },
			});
		}).pipe(Effect.provide(CurrentSession.layer)),
);

const program = Command.run({ version: webPackage.version })(web);

BunRuntime.runMain()(
	program.pipe(
		Effect.provide(DevSessions.layer),
		Effect.provide(BunServices.layer),
		Effect.scoped,
	),
);
