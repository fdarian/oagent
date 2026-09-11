import { Context, Effect, Layer } from 'effect';
import { AcpAgent, AcpSessionError } from './acp-agent.ts';

export class OpenCode extends Context.Service<OpenCode>()('oagent/OpenCode', {
	make: Effect.gen(function* () {
		const binary =
			process.env.OAGENT_OPENCODE_BIN !== undefined
				? process.env.OAGENT_OPENCODE_BIN
				: 'opencode';
		const acpAgent = yield* AcpAgent.pipe(
			Effect.provide(
				AcpAgent.layer({
					binary,
					args: ['acp'],
					clientInfoName: 'oagent',
				}),
			),
		);

		const listModels = () =>
			Effect.tryPromise({
				try: async () => {
					const proc = Bun.spawn([binary, 'models'], { stdout: 'pipe' });
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
	static readonly layer = Layer.effect(OpenCode, OpenCode.make);
}
