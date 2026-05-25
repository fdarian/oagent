import { join } from 'node:path';
import { defineDevCli } from '@oagent/common';
import { Effect } from 'effect';
import webPackage from '../package.json' with { type: 'json' };

const REPO_ROOT = join(import.meta.dirname, '../../..');

const main = defineDevCli({
	name: webPackage.name,
	dir: join(REPO_ROOT, 'apps/web'),
	run: (ctx) =>
		Effect.gen(function* () {
			const s = yield* ctx.session;
			yield* Effect.logInfo(`[dev] session: ${s.name}`);

			const engine = yield* ctx.awaitRunning<{ url: string }>('@oagent/engine');
			yield* Effect.logInfo(`[dev] using engine url: ${engine.url}`);

			yield* ctx.runManagedSubprocess('bunx', ['vite'], {
				env: { ENGINE_URL: engine.url },
			});
		}),
});

main(process.argv);
