import { Context, Effect, Layer } from 'effect';
import { Claude } from './claude.ts';
import { Codex } from './codex.ts';
import { Cursor } from './cursor.ts';
import { CustomHarnesses } from './custom-harnesses.ts';
import { Grok } from './grok.ts';
import {
	type Backend,
	type Harness,
	type HarnessId,
	isBackend,
	type UnknownHarness,
} from './harness.ts';
import { OpenCode } from './opencode.ts';
import { Pi } from './pi.ts';

export class HarnessRegistry extends Context.Service<HarnessRegistry>()(
	'oagent/HarnessRegistry',
	{
		make: Effect.gen(function* () {
			const opencode = yield* OpenCode;
			const cursor = yield* Cursor;
			const grok = yield* Grok;
			const codex = yield* Codex;
			const claude = yield* Claude;
			const pi = yield* Pi;
			const customHarnesses = yield* CustomHarnesses;
			const byBackend: Record<Backend, Harness> = {
				opencode,
				cursor,
				grok,
				codex,
				claude,
				pi,
			};
			const builtins: ReadonlyArray<Harness> = [
				byBackend.opencode,
				byBackend.cursor,
				byBackend.grok,
				byBackend.codex,
				byBackend.claude,
				byBackend.pi,
			];

			/** For callers that already hold a builtin `Backend`, such as codex auth. */
			const builtin = (backend: Backend): Harness => byBackend[backend];
			const resolve = (
				harnessId: HarnessId,
			): Effect.Effect<Harness, UnknownHarness> =>
				isBackend(harnessId)
					? Effect.succeed(byBackend[harnessId])
					: customHarnesses.resolve(harnessId);
			const list = () =>
				customHarnesses
					.resolveAll()
					.pipe(Effect.map((custom) => [...builtins, ...custom]));
			const listAgentTargets = (harnessId: HarnessId) =>
				resolve(harnessId).pipe(
					Effect.flatMap((harness) => harness.listAgentTargets()),
				);

			return { builtin, resolve, list, listAgentTargets };
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
		Layer.provide(Claude.layer),
		Layer.provide(Pi.layer),
		Layer.provide(CustomHarnesses.layer),
	);
}
