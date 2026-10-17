import { Context, Effect, Layer } from 'effect';
import { Claude } from './claude.ts';
import { Codex } from './codex.ts';
import { Cursor } from './cursor.ts';
import { CustomHarnesses } from './custom-harnesses.ts';
import { Grok } from './grok.ts';
import {
	type AcpCommand,
	type Backend,
	type Harness,
	type HarnessId,
	INLINE_ACP_HARNESS_ID,
	isBackend,
	UnknownHarness,
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
			/**
			 * Answered without resolving: custom and inline harnesses never switch
			 * models, and resolving them would spawn an adapter just to read a flag.
			 */
			const supportsModelSwitch = (harnessId: HarnessId): boolean =>
				isBackend(harnessId) && byBackend[harnessId].supportsModelSwitch;
			/**
			 * The one place that turns a session row into its harness: inline
			 * sessions launch from the definition stored on the row, everything
			 * else resolves by id.
			 */
			const resolveForSession = (session: {
				readonly backend: HarnessId;
				readonly acp_command: AcpCommand | null;
			}): Effect.Effect<Harness, UnknownHarness> => {
				if (session.backend !== INLINE_ACP_HARNESS_ID) {
					return resolve(session.backend);
				}
				return session.acp_command === null
					? Effect.fail(new UnknownHarness({ harnessId: session.backend }))
					: customHarnesses.resolveInline(session.acp_command);
			};
			const list = () =>
				customHarnesses
					.resolveAll()
					.pipe(Effect.map((custom) => [...builtins, ...custom]));
			const listAgentTargets = (harnessId: HarnessId) =>
				resolve(harnessId).pipe(
					Effect.flatMap((harness) => harness.listAgentTargets()),
				);

			return {
				builtin,
				resolve,
				resolveForSession,
				supportsModelSwitch,
				list,
				listAgentTargets,
			};
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
