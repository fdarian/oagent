import { Context, Effect, Layer, Ref, Semaphore } from 'effect';
import {
	AcpAgent,
	type AcpAgentConfig,
	type AcpConfigOption,
	probeAcpConnection,
} from './acp-agent.ts';
import type { Harness } from './harness.ts';
import { ModelsCache } from './models-cache.ts';
import { Settings } from './settings.ts';

const CODEX_ACP_BINARY = 'codex-acp';
const CODEX_CLI_BINARY = 'codex';

type VersionState = {
	loaded: boolean;
	value: string | undefined;
};

export function getCodexBinary(): string {
	return process.env.OAGENT_CODEX_BIN ?? CODEX_ACP_BINARY;
}

export function resolveCodexBinary(): string | undefined {
	return Bun.which(getCodexBinary()) ?? undefined;
}

export function getCodexCliBinary(): string {
	return process.env.CODEX_PATH ?? CODEX_CLI_BINARY;
}

export function resolveCodexCliBinary(): string | undefined {
	return Bun.which(getCodexCliBinary()) ?? undefined;
}

export function createCodexAcpConfig(
	getCodexHome: () => string | undefined,
	getExtraEnv?: () => Record<string, string>,
): AcpAgentConfig {
	return {
		binary: resolveCodexBinary() ?? getCodexBinary(),
		args: [] as const,
		clientInfoName: 'oagent',
		env: () => {
			const configuredBinary = process.env.OAGENT_CODEX_BIN;
			const env: Record<string, string | undefined> = {};
			if (configuredBinary === undefined) {
				const codexPath = resolveCodexCliBinary();
				if (codexPath !== undefined) env.CODEX_PATH = codexPath;
			}
			const codexHome = getCodexHome();
			if (codexHome !== undefined) env.CODEX_HOME = codexHome;
			return {
				...env,
				...(getExtraEnv === undefined ? {} : getExtraEnv()),
			};
		},
	};
}

const codexAcpLayer = Layer.unwrap(
	Effect.gen(function* () {
		const settings = yield* Settings;
		return AcpAgent.layer(
			createCodexAcpConfig(settings.getCodexHome, () =>
				settings.getHarnessEnv('codex'),
			),
		);
	}),
);

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
		const acpAgent = yield* AcpAgent;
		const settings = yield* Settings;
		const createConfig = () =>
			createCodexAcpConfig(settings.getCodexHome, () =>
				settings.getHarnessEnv('codex'),
			);
		const versionRef = yield* Ref.make<VersionState>({
			loaded: false,
			value: undefined,
		});
		const versionSemaphore = yield* Semaphore.make(1);
		const version = () =>
			versionSemaphore.withPermit(
				Effect.gen(function* () {
					const memoized = yield* Ref.get(versionRef);
					if (memoized.loaded) return memoized.value;
					const info = yield* probeAcpConnection(createConfig());
					yield* Ref.set(versionRef, {
						loaded: true,
						value: info.agentVersion,
					});
					return info.agentVersion;
				}),
			);
		const fetchModels = () =>
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
			);
		const modelCache = yield* ModelsCache.make(() => fetchModels());
		const effortCache = yield* ModelsCache.make(() => Effect.succeed([]));
		const listModels = () => modelCache.get('models');
		const listModelEfforts = (model: string) => effortCache.get(model);
		const invalidate = () =>
			Effect.gen(function* () {
				yield* modelCache.invalidate();
				yield* effortCache.invalidate();
			});
		return {
			backend: 'codex',
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
			listModels,
			listModelEfforts,
			resolveBinary: resolveCodexBinary,
			version,
			invalidate,
			createConfig,
		} satisfies Harness;
	}),
}) {
	static readonly layer = Layer.effect(Codex, Codex.make).pipe(
		Layer.provide(codexAcpLayer),
		Layer.provide(Settings.layer),
	);
}
