import { Context, Effect, Layer } from 'effect';
import { AcpAgent, type AcpAgentConfig, AcpSessionError } from './acp-agent.ts';

const OPENCODE_BINARY = 'opencode';

export function getOpenCodeBinary(): string {
	return process.env.OAGENT_OPENCODE_BIN ?? OPENCODE_BINARY;
}

export function resolveOpenCodeBinary(): string | undefined {
	return Bun.which(getOpenCodeBinary()) ?? undefined;
}

export function createOpenCodeAcpConfig(): AcpAgentConfig {
	return {
		binary: resolveOpenCodeBinary() ?? getOpenCodeBinary(),
		args: ['acp'] as const,
		clientInfoName: 'oagent',
	};
}

export class OpenCode extends Context.Service<OpenCode>()('oagent/OpenCode', {
	make: Effect.gen(function* () {
		const acpAgent = yield* AcpAgent;
		const binary = resolveOpenCodeBinary() ?? getOpenCodeBinary();

		const listModels = () =>
			Effect.tryPromise({
				try: async () => {
					const proc = Bun.spawn([binary, 'models'], {
						stdout: 'pipe',
					});
					const text = await new Response(proc.stdout).text();
					await proc.exited;
					return text
						.trim()
						.split('\n')
						.filter((line) => line.length > 0)
						.map((id) => ({ id }));
				},
				catch: (cause) => new AcpSessionError({ cause }),
			});

		return {
			runTurn: acpAgent.runTurn,
			listModels,
		} satisfies AcpAgent['Service'];
	}),
}) {
	static readonly layer = Layer.effect(OpenCode, OpenCode.make).pipe(
		Layer.provide(AcpAgent.layer(createOpenCodeAcpConfig())),
	);
}
