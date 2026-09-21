import { Context, Effect, Layer, Ref, Semaphore } from 'effect';
import {
	AcpAgent,
	type AcpAgentConfig,
	type AcpConfigOption,
	checkAcpConnection,
	probeAcpConnection,
} from './acp-agent.ts';
import type { Harness } from './harness.ts';
import { ModelsCache } from './models-cache.ts';
import { Settings } from './settings.ts';

const CLAUDE_BINARY = 'claude-agent-acp';

const CLAUDE_EFFORTS = [
	{ value: 'default', label: 'Default' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
	{ value: 'max', label: 'Max' },
] as const;

type VersionState = {
	loaded: boolean;
	value: string | undefined;
};

export function getClaudeBinary(): string {
	return process.env.OAGENT_CLAUDE_BIN ?? CLAUDE_BINARY;
}

export function resolveClaudeBinary(): string | undefined {
	return Bun.which(getClaudeBinary()) ?? undefined;
}

export function createClaudeAcpConfig(
	getExtraEnv?: () => Record<string, string>,
): AcpAgentConfig {
	return {
		binary: resolveClaudeBinary() ?? getClaudeBinary(),
		args: [],
		clientInfoName: 'oagent',
		...(getExtraEnv === undefined
			? {}
			: { env: () => ({ ...process.env, ...getExtraEnv() }) }),
	};
}

export function getClaudeConfigOptions(
	model: string | undefined,
	reasoningEffort: string | undefined,
): ReadonlyArray<AcpConfigOption> | undefined {
	const options = [
		...(model === undefined ? [] : [{ configId: 'model', value: model }]),
		...(reasoningEffort === undefined
			? []
			: [{ configId: 'effort', value: reasoningEffort }]),
	];
	return options.length === 0 ? undefined : options;
}

const claudeAcpLayer = Layer.unwrap(
	Effect.gen(function* () {
		const settings = yield* Settings;
		return AcpAgent.layer(
			createClaudeAcpConfig(() => settings.getHarnessEnv('claude')),
		);
	}),
);

export class Claude extends Context.Service<Claude>()('oagent/Claude', {
	make: Effect.gen(function* () {
		const acpAgent = yield* AcpAgent;
		const settings = yield* Settings;
		const createConfig = () =>
			createClaudeAcpConfig(() => settings.getHarnessEnv('claude'));
		const check = () => checkAcpConnection('claude', createConfig());
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
			acpAgent
				.listModels()
				.pipe(
					Effect.map((models) => models.map((entry) => ({ id: entry.id }))),
				);
		const modelCache = yield* ModelsCache.make(() => fetchModels());
		const listModels = () => modelCache.get();
		const listModelEfforts = () => Effect.succeed(CLAUDE_EFFORTS);
		const invalidate = () => modelCache.invalidate();

		return {
			backend: 'claude',
			runTurn: (input: Parameters<typeof acpAgent.runTurn>[0]) =>
				acpAgent.runTurn({
					...input,
					model: undefined,
					reasoningEffort: undefined,
					configOptions: getClaudeConfigOptions(
						input.model,
						input.reasoningEffort,
					),
				}),
			listModels,
			listModelEfforts,
			listAgentTargets: () => Effect.succeed([]),
			resolveBinary: resolveClaudeBinary,
			version,
			invalidate,
			check,
		} satisfies Harness;
	}),
}) {
	static readonly layer = Layer.effect(Claude, Claude.make).pipe(
		Layer.provide(claudeAcpLayer),
		Layer.provide(Settings.layer),
	);
}
