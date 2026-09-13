import { eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import {
	type AcpAgent,
	type AcpAgentConfig,
	type AcpConfigOption,
	makeAcpAgent,
} from './acp-agent.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';

const CODEX_ACP_BINARY = 'codex-acp';

export function getCodexBinary(): string {
	return process.env.OAGENT_CODEX_BIN ?? CODEX_ACP_BINARY;
}

export function resolveCodexBinary(): string | undefined {
	return Bun.which(getCodexBinary()) ?? undefined;
}

export function createCodexAcpConfig(
	getCodexHome: () => string | undefined,
): AcpAgentConfig {
	return {
		binary: resolveCodexBinary() ?? getCodexBinary(),
		args: [] as const,
		clientInfoName: 'oagent',
		env: () => {
			const configuredBinary = process.env.OAGENT_CODEX_BIN;
			const codexPath =
				configuredBinary === undefined
					? (process.env.CODEX_PATH ?? Bun.which('codex') ?? undefined)
					: undefined;
			const env: Record<string, string | undefined> = {};
			if (codexPath !== undefined) env.CODEX_PATH = codexPath;
			const codexHome = getCodexHome();
			if (codexHome !== undefined) env.CODEX_HOME = codexHome;
			return env;
		},
	};
}

function getCodexConfigOptions(
	model: string | undefined,
	reasoningEffort: string | undefined,
): ReadonlyArray<AcpConfigOption> | undefined {
	if (model === undefined) return undefined;

	const openingBracket = model.lastIndexOf('[');
	if (openingBracket === -1 || !model.endsWith(']')) {
		return [
			{ configId: 'model', value: model },
			...(reasoningEffort !== undefined
				? [{ configId: 'reasoning_effort', value: reasoningEffort }]
				: []),
		];
	}

	const modelId = model.slice(0, openingBracket);
	const suffixEffort = model.slice(openingBracket + 1, -1);
	if (modelId.length === 0 || suffixEffort.length === 0) {
		return [{ configId: 'model', value: model }];
	}
	const selectedEffort =
		reasoningEffort !== undefined ? reasoningEffort : suffixEffort;

	return [
		{ configId: 'model', value: modelId },
		...(selectedEffort !== undefined && selectedEffort.length > 0
			? [{ configId: 'reasoning_effort', value: selectedEffort }]
			: []),
	];
}

function getCodexModelId(model: string): string {
	const openingBracket = model.lastIndexOf('[');
	if (openingBracket === -1 || !model.endsWith(']')) return model;

	const modelId = model.slice(0, openingBracket);
	const reasoningEffort = model.slice(openingBracket + 1, -1);
	return modelId.length === 0 || reasoningEffort.length === 0 ? model : modelId;
}

export class Codex extends Context.Service<Codex>()('oagent/Codex', {
	make: Effect.gen(function* () {
		const dbService = yield* Db;
		const acpAgent = yield* makeAcpAgent(
			createCodexAcpConfig(() => {
				const row = dbService.db
					.select()
					.from(schema.settings)
					.where(eq(schema.settings.key, 'codex_home'))
					.limit(1)
					.get();
				return row?.value;
			}),
		);
		return {
			runTurn: (input: Parameters<typeof acpAgent.runTurn>[0]) => {
				const configOptions = getCodexConfigOptions(
					input.model,
					input.reasoningEffort,
				);
				return acpAgent.runTurn({
					...input,
					model: undefined,
					configOptions,
				});
			},
			listModels: () =>
				acpAgent.listModels().pipe(
					Effect.map((models) => {
						const seen = new Set<string>();
						const result: Array<{ id: string }> = [];
						for (const model of models) {
							const id = getCodexModelId(model.id);
							if (seen.has(id)) continue;
							seen.add(id);
							result.push({ id });
						}
						return result;
					}),
				),
		} satisfies AcpAgent['Service'];
	}),
}) {
	static readonly layer = Layer.effect(Codex, Codex.make).pipe(
		Layer.provide(Db.layer),
	);
}
