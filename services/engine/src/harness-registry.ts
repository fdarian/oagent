import { Context, Effect, Layer } from 'effect';
import { Codex } from './codex.ts';
import { Cursor } from './cursor.ts';
import { Grok } from './grok.ts';
import type { Backend, Harness } from './harness.ts';
import { OpenCode } from './opencode.ts';

export class HarnessRegistry extends Context.Service<HarnessRegistry>()(
	'oagent/HarnessRegistry',
	{
		make: Effect.gen(function* () {
			const opencode = yield* OpenCode;
			const cursor = yield* Cursor;
			const grok = yield* Grok;
			const codex = yield* Codex;
			const byBackend: Record<Backend, Harness> = {
				opencode,
				cursor,
				grok,
				codex,
			};
			const all: ReadonlyArray<Harness> = [
				byBackend.opencode,
				byBackend.cursor,
				byBackend.grok,
				byBackend.codex,
			];

			const get = (backend: Backend): Harness => byBackend[backend];
			const listAgentTargets = (backend: Backend) =>
				get(backend).listAgentTargets();

			return { all, get, listAgentTargets };
		}),
	},
) {
	static readonly layer = Layer.effect(
		HarnessRegistry,
		HarnessRegistry.make,
	).pipe(
		Layer.provide(OpenCode.layer),
		Layer.provide(Cursor.layer),
		Layer.provide(Grok.layer),
		Layer.provide(Codex.layer),
	);
}
