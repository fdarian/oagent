import { Context, Effect, Layer } from 'effect';
import { AcpAgent } from './acp-agent.ts';

export class Codex extends Context.Service<Codex>()('oagent/Codex', {
	make: Effect.gen(function* () {
		const binary =
			process.env.OAGENT_CODEX_BIN !== undefined
				? process.env.OAGENT_CODEX_BIN
				: 'codex-acp';
		const acpAgent = yield* Effect.provide(
			AcpAgent,
			AcpAgent.layer({
				binary,
				args: [],
				clientInfoName: 'oagent',
			}),
		);
		return {
			runTurn: (input: Parameters<typeof acpAgent.runTurn>[0]) =>
				acpAgent.runTurn(input),
			listModels: () => acpAgent.listModels(),
		} satisfies AcpAgent['Service'];
	}),
}) {
	static readonly layer = Layer.effect(Codex, Codex.make);
}
