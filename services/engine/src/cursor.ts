import { Effect } from 'effect';
import { AcpAgent } from './acp-agent.ts';

export class Cursor extends Effect.Service<Cursor>()('oagent/Cursor', {
	effect: Effect.gen(function* () {
		const binary =
			process.env.OAGENT_CURSOR_BIN !== undefined
				? process.env.OAGENT_CURSOR_BIN
				: 'agent';
		const acpAgent = yield* AcpAgent.pipe(
			Effect.provide(
				AcpAgent.Default({
					binary,
					args: ['acp'],
					clientInfoName: 'oagent',
					extensionHandlers: {
						'cursor/ask_question': async () => ({
							outcome: {
								outcome: 'skipped',
								reason: 'auto-skipped by oagent',
							},
						}),
						'cursor/create_plan': async () => ({
							outcome: {
								outcome: 'accepted',
							},
						}),
					},
				}),
			),
		);
		return { runTurn: acpAgent.runTurn };
	}),
}) {}
