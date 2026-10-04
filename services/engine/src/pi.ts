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

const PI_EFFORTS = [
	{ value: 'off', label: 'Off' },
	{ value: 'minimal', label: 'Minimal' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' },
	{ value: 'xhigh', label: 'Extra high' },
	{ value: 'max', label: 'Max' },
] as const;

export function getPiBinary(): string {
	return process.env.OAGENT_PI_BIN ?? 'pi-acp';
}

export function resolvePiBinary(): string | undefined {
	return Bun.which(getPiBinary()) ?? undefined;
}

export function createPiAcpConfig(
	getExtraEnv?: () => Record<string, string>,
): AcpAgentConfig {
	return {
		binary: resolvePiBinary() ?? getPiBinary(),
		args: [],
		clientInfoName: 'oagent',
		...(getExtraEnv === undefined
			? {}
			: { env: () => ({ ...process.env, ...getExtraEnv() }) }),
	};
}

export function getPiConfigOptions(
	model: string | undefined,
	reasoningEffort: string | undefined,
): ReadonlyArray<AcpConfigOption> | undefined {
	const options = [
		...(model === undefined ? [] : [{ configId: 'model', value: model }]),
		...(reasoningEffort === undefined
			? []
			: [{ configId: 'thought_level', value: reasoningEffort }]),
	];
	return options.length === 0 ? undefined : options;
}

const piAcpLayer = Layer.unwrap(
	Effect.gen(function* () {
		const settings = yield* Settings;
		return AcpAgent.layer(
			createPiAcpConfig(() => settings.getHarnessEnv('pi')),
		);
	}),
);

export class Pi extends Context.Service<Pi>()('oagent/Pi', {
	make: Effect.gen(function* () {
		const acpAgent = yield* AcpAgent;
		const settings = yield* Settings;
		const createConfig = () =>
			createPiAcpConfig(() => settings.getHarnessEnv('pi'));
		const versionRef = yield* Ref.make<{
			loaded: boolean;
			value: string | undefined;
		}>({ loaded: false, value: undefined });
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
		const modelCache = yield* ModelsCache.make(() => acpAgent.listModels());
		return {
			backend: 'pi',
			supportsModelSwitch: false,
			runTurn: (input: Parameters<typeof acpAgent.runTurn>[0]) =>
				acpAgent.runTurn({
					...input,
					model: undefined,
					reasoningEffort: undefined,
					configOptions: getPiConfigOptions(input.model, input.reasoningEffort),
				}),
			listModels: () => modelCache.get(),
			listModelEfforts: () => Effect.succeed(PI_EFFORTS),
			listAgentTargets: () => Effect.succeed([]),
			resolveBinary: resolvePiBinary,
			version,
			invalidate: () => modelCache.invalidate(),
			check: () => checkAcpConnection('pi', createConfig()),
		} satisfies Harness;
	}),
}) {
	static readonly layer = Layer.effect(Pi, Pi.make).pipe(
		Layer.provide(piAcpLayer),
		Layer.provide(Settings.layer),
	);
}
