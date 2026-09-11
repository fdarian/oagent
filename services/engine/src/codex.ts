import { Context, Effect, Layer } from 'effect';
import { AcpAgent, type AcpAgentService } from './acp-agent.ts';

type CodexService = {
	readonly runTurn: AcpAgentService['runTurn'];
	readonly listModels: AcpAgentService['listModels'];
};

const makeCodex = Effect.gen(function* () {
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
		};
});

export class Codex extends Context.Service<Codex, CodexService>()(
	'oagent/Codex',
) {
	static readonly layer = Layer.effect(Codex, makeCodex);
}
