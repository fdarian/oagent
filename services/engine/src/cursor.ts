import { Context, Effect, Layer } from 'effect';
import { AcpAgent } from './acp-agent.ts';

const CURSOR_MODEL_ALIASES: Record<string, string> = {
	auto: 'default[]',
	'composer-2.5': 'composer-2.5[fast=true]',
	'composer-2': 'composer-2[fast=true]',
	sonnet: 'claude-sonnet-4-6[thinking=true,context=200k,effort=medium]',
	opus: 'claude-opus-4-7[thinking=true,context=300k,effort=xhigh,fast=false]',
	'kimi-k2.5': 'kimi-k2.5[]',
	'gemini-3.1-pro': 'gemini-3.1-pro[]',
	'grok-4.3': 'grok-4.3[context=200k]',
	'gpt-5.5': 'gpt-5.5[context=272k,reasoning=medium,fast=false]',
};

// Inverse map: canonical id → friendly alias label, built once at module load.
const CURSOR_ID_TO_LABEL: ReadonlyMap<string, string> = new Map(
	Object.entries(CURSOR_MODEL_ALIASES).map(([label, id]) => [id, label]),
);

const CURSOR_ACP_CONFIG = {
	binary:
		process.env.OAGENT_CURSOR_BIN !== undefined
			? process.env.OAGENT_CURSOR_BIN
			: 'cursor-agent',
	args: ['acp'] as const,
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
};

export class Cursor extends Context.Service<Cursor>()('oagent/Cursor', {
	make: Effect.gen(function* () {
		const acpAgent = yield* AcpAgent;
		return {
			runTurn: (input: Parameters<typeof acpAgent.runTurn>[0]) => {
				const model =
					input.model !== undefined && input.model in CURSOR_MODEL_ALIASES
						? CURSOR_MODEL_ALIASES[input.model]
						: input.model;
				return acpAgent.runTurn({ ...input, model });
			},
			listModels: () =>
				acpAgent.listModels().pipe(
					Effect.map((models) =>
						models.map((entry) => ({
							id: entry.id,
							label: CURSOR_ID_TO_LABEL.get(entry.id),
						})),
					),
				),
		} satisfies AcpAgent['Service'];
	}),
}) {
	static readonly layer = Layer.effect(Cursor, Cursor.make).pipe(
		Layer.provide(AcpAgent.layer(CURSOR_ACP_CONFIG)),
	);
}
