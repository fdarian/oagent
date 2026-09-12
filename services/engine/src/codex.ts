import { Context, Effect, Layer } from 'effect';
import { AcpAgent } from './acp-agent.ts';

const CODEX_ACP_BINARY = 'codex-acp';

export class Codex extends Context.Service<Codex>()('oagent/Codex', {
	make: Effect.gen(function* () {
		const configuredBinary = process.env.OAGENT_CODEX_BIN;
		const binary = configuredBinary ?? CODEX_ACP_BINARY;
		const codexPath =
			configuredBinary === undefined
				? (process.env.CODEX_PATH ?? Bun.which('codex'))
				: undefined;
		const acpAgent = yield* Effect.provide(
			AcpAgent,
			AcpAgent.layer({
				binary,
				args: [],
				clientInfoName: 'oagent',
				env:
					codexPath === null || codexPath === undefined
						? undefined
						: { CODEX_PATH: codexPath },
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
