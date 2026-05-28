import { Effect } from 'effect';
import { AcpAgent } from './acp-agent.ts';

export class OpenCode extends Effect.Service<OpenCode>()('oagent/OpenCode', {
	effect: Effect.gen(function* () {
		const binary =
			process.env.OAGENT_OPENCODE_BIN !== undefined
				? process.env.OAGENT_OPENCODE_BIN
				: 'opencode';
		const acpAgent = yield* AcpAgent.pipe(
			Effect.provide(
				AcpAgent.Default({
					binary,
					args: ['acp'],
					clientInfoName: 'oagent',
				}),
			),
		);
		return { runTurn: acpAgent.runTurn, listModels: acpAgent.listModels };
	}),
}) {}
