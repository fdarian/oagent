import { Context, Effect, Layer } from 'effect';
import { AcpAgent, type AcpConfigOption } from './acp-agent.ts';

const CODEX_ACP_BINARY = 'codex-acp';

const CODEX_ACP_CONFIG = (() => {
	const configuredBinary = process.env.OAGENT_CODEX_BIN;
	const binary = configuredBinary ?? CODEX_ACP_BINARY;
	const codexPath =
		configuredBinary === undefined
			? (process.env.CODEX_PATH ?? Bun.which('codex'))
			: undefined;
	return {
		binary,
		args: [] as const,
		clientInfoName: 'oagent',
		env:
			codexPath === null || codexPath === undefined
				? undefined
				: { CODEX_PATH: codexPath },
	};
})();

function getCodexConfigOptions(
	model: string | undefined,
): ReadonlyArray<AcpConfigOption> | undefined {
	if (model === undefined) return undefined;

	const openingBracket = model.lastIndexOf('[');
	if (openingBracket === -1 || !model.endsWith(']')) {
		return [{ configId: 'model', value: model }];
	}

	const modelId = model.slice(0, openingBracket);
	const reasoningEffort = model.slice(openingBracket + 1, -1);
	if (modelId.length === 0 || reasoningEffort.length === 0) {
		return [{ configId: 'model', value: model }];
	}

	return [
		{ configId: 'model', value: modelId },
		{ configId: 'reasoning_effort', value: reasoningEffort },
	];
}

export class Codex extends Context.Service<Codex>()('oagent/Codex', {
	make: Effect.gen(function* () {
		const acpAgent = yield* AcpAgent;
		return {
			runTurn: (input: Parameters<typeof acpAgent.runTurn>[0]) => {
				const configOptions = getCodexConfigOptions(input.model);
				return acpAgent.runTurn({
					...input,
					model: undefined,
					configOptions,
				});
			},
			listModels: () => acpAgent.listModels(),
		} satisfies AcpAgent['Service'];
	}),
}) {
	static readonly layer = Layer.effect(Codex, Codex.make).pipe(
		Layer.provide(AcpAgent.layer(CODEX_ACP_CONFIG)),
	);
}
