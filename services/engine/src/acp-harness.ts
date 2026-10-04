import { Effect, Layer, Ref, Semaphore } from 'effect';
import {
	AcpAgent,
	type AcpAgentConfig,
	type AcpConfigOption,
	checkAcpConnection,
	probeAcpConnection,
} from './acp-agent.ts';
import type { Backend, Harness, ModelEffort } from './harness.ts';
import { ModelsCache } from './models-cache.ts';
import { Settings } from './settings.ts';

export function makeAcpAdapterHarness(options: {
	backend: Backend;
	defaultBinary: string;
	binaryEnvVar: string;
	effortConfigId: string;
	efforts: ReadonlyArray<ModelEffort>;
	omitDefaultEffort?: boolean;
}) {
	const getBinary = () =>
		process.env[options.binaryEnvVar] ?? options.defaultBinary;
	const resolveBinary = () => Bun.which(getBinary()) ?? undefined;
	const createConfig = (
		getExtraEnv?: () => Record<string, string>,
	): AcpAgentConfig => ({
		binary: resolveBinary() ?? getBinary(),
		args: [],
		clientInfoName: 'oagent',
		...(getExtraEnv === undefined
			? {}
			: { env: () => ({ ...process.env, ...getExtraEnv() }) }),
	});
	const getConfigOptions = (
		model: string | undefined,
		effort: string | undefined,
	): ReadonlyArray<AcpConfigOption> | undefined => {
		const configOptions = [
			...(model === undefined ? [] : [{ configId: 'model', value: model }]),
			...(effort === undefined ||
			(options.omitDefaultEffort === true && effort === 'default')
				? []
				: [{ configId: options.effortConfigId, value: effort }]),
		];
		return configOptions.length === 0 ? undefined : configOptions;
	};
	const acpLayer = Layer.unwrap(
		Effect.gen(function* () {
			const settings = yield* Settings;
			return AcpAgent.layer(
				createConfig(() => settings.getHarnessEnv(options.backend)),
			);
		}),
	);
	const make = Effect.gen(function* () {
		const acpAgent = yield* AcpAgent;
		const settings = yield* Settings;
		const config = () =>
			createConfig(() => settings.getHarnessEnv(options.backend));
		const versionRef = yield* Ref.make<{
			loaded: boolean;
			value: string | undefined;
		}>({ loaded: false, value: undefined });
		const semaphore = yield* Semaphore.make(1);
		const version = () =>
			semaphore.withPermit(
				Effect.gen(function* () {
					const memoized = yield* Ref.get(versionRef);
					if (memoized.loaded) return memoized.value;
					const info = yield* probeAcpConnection(config());
					yield* Ref.set(versionRef, {
						loaded: true,
						value: info.agentVersion,
					});
					return info.agentVersion;
				}),
			);
		const models = yield* ModelsCache.make(() =>
			acpAgent
				.listModels()
				.pipe(
					Effect.map((entries) => entries.map((entry) => ({ id: entry.id }))),
				),
		);
		return {
			backend: options.backend,
			supportsModelSwitch: false,
			runTurn: (input: Parameters<typeof acpAgent.runTurn>[0]) =>
				acpAgent.runTurn({
					...input,
					model: undefined,
					reasoningEffort: undefined,
					configOptions: getConfigOptions(input.model, input.reasoningEffort),
				}),
			listModels: () => models.get(),
			listModelEfforts: () => Effect.succeed(options.efforts),
			listAgentTargets: () => Effect.succeed([]),
			resolveBinary,
			version,
			invalidate: () => models.invalidate(),
			check: () => checkAcpConnection(options.backend, config()),
		} satisfies Harness;
	});
	return {
		getBinary,
		resolveBinary,
		createConfig,
		getConfigOptions,
		make,
		acpLayer,
	};
}
