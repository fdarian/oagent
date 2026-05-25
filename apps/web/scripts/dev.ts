import { join } from 'node:path';
import { defineDevCli } from '@oagent/common';
import { Effect } from 'effect';
import webPackage from '../package.json' with { type: 'json' };

const REPO_ROOT = join(import.meta.dirname, '../../..');

const main = defineDevCli({
	name: webPackage.name,
	dir: join(REPO_ROOT, 'apps/web'),
	run: ({ session, sibling, runManagedSubprocess }) =>
		Effect.gen(function* () {
			const s = yield* session;
			yield* Effect.logInfo(`[dev] session: ${s.name}`);

			const engine = sibling('@oagent/engine');
			const { url: engineUrl } = yield* engine.getFile<{
				url: string;
			}>();
			yield* Effect.logInfo(`[dev] using engine url: ${engineUrl}`);

			yield* runManagedSubprocess('bunx', ['vite'], {
				env: { ENGINE_URL: engineUrl },
			});
		}),
});

main(process.argv);
