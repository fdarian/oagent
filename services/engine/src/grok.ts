import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { Context, Effect, Layer, Ref, Semaphore } from 'effect';
import {
	type AcpAgentConfig,
	AcpSessionError,
	checkAcpConnection,
	createAcpConnection,
	probeAcpConnection,
	runAcpTurn,
} from './acp-agent.ts';
import type { Harness } from './harness.ts';
import { ModelsCache } from './models-cache.ts';
import { Settings } from './settings.ts';

const GROK_BINARY = 'grok';

type VersionState = {
	loaded: boolean;
	value: string | undefined;
};

export function getGrokBinary(): string {
	return process.env.OAGENT_GROK_BIN ?? GROK_BINARY;
}

export function resolveGrokBinary(): string | undefined {
	return Bun.which(getGrokBinary()) ?? undefined;
}

export function createGrokAcpConfig(
	model?: string,
	getExtraEnv?: () => Record<string, string>,
): AcpAgentConfig {
	return {
		binary: resolveGrokBinary() ?? getGrokBinary(),
		args:
			model === undefined
				? ['agent', 'stdio']
				: ['agent', '-m', model, 'stdio'],
		clientInfoName: 'oagent',
		...(getExtraEnv === undefined
			? {}
			: { env: () => ({ ...process.env, ...getExtraEnv() }) }),
	};
}

export class Grok extends Context.Service<Grok>()('oagent/Grok', {
	make: Effect.gen(function* () {
		const settings = yield* Settings;
		const binary = resolveGrokBinary() ?? getGrokBinary();
		const createConfig = () =>
			createGrokAcpConfig(undefined, () => settings.getHarnessEnv('grok'));
		const check = () => checkAcpConnection('grok', createConfig());
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
			Effect.tryPromise({
				try: async () => {
					const proc = Bun.spawn([binary, 'models'], {
						stdout: 'pipe',
						env: { ...process.env, ...settings.getHarnessEnv('grok') },
					});
					const text = await new Response(proc.stdout).text();
					const exitCode = await proc.exited;
					if (exitCode !== 0) {
						throw new Error(`grok models exited with code ${exitCode}`);
					}
					const lines = text.split('\n');
					const availableIdx = lines.findIndex(
						(line) => line.trim() === 'Available models:',
					);
					if (availableIdx === -1) {
						throw new Error(
							'Unexpected grok models output: no "Available models:" section found',
						);
					}
					const models: { id: string }[] = [];
					for (let i = availableIdx + 1; i < lines.length; i++) {
						const rawLine = lines[i];
						if (rawLine === undefined) break;
						const line = rawLine.trim();
						if (line === '') break;
						let id = line;
						if (id.startsWith('- ') || id.startsWith('* ')) {
							id = id.slice(2);
						}
						const suffix = ' (default)';
						if (id.endsWith(suffix)) {
							id = id.slice(0, -suffix.length);
						}
						if (id.length > 0) {
							models.push({ id });
						}
					}
					if (models.length === 0) {
						throw new Error('No models found in grok models output');
					}
					return models;
				},
				catch: (cause) => new AcpSessionError({ cause }),
			});
		const modelCache = yield* ModelsCache.make(() => fetchModels());
		const listModels = () => modelCache.get();
		const listModelEfforts = () => Effect.succeed([]);
		const invalidate = () => modelCache.invalidate();

		const runTurn = (input: {
			prompt: string;
			model?: string;
			sessionId?: string;
			cwd: string;
			onSessionId?: (sessionId: string) => void;
			onEvent?: (event: SessionUpdate) => void;
		}) =>
			Effect.scoped(
				Effect.gen(function* () {
					const connEnv = yield* createAcpConnection(
						createGrokAcpConfig(input.model, () =>
							settings.getHarnessEnv('grok'),
						),
					);
					// WORKAROUND: grok cannot change the model once a session has been created
					// (unlike opencode/cursor which switch model per-turn over ACP), so the model
					// must be fixed at process launch via -m. This requires a fresh subprocess per turn.
					return yield* runAcpTurn(connEnv, {
						...input,
						reasoningEffort: undefined,
						skipModelSet: true,
					});
				}),
			);

		return {
			backend: 'grok',
			runTurn,
			listModels,
			listModelEfforts,
			resolveBinary: resolveGrokBinary,
			version,
			invalidate,
			check,
		} satisfies Harness;
	}),
}) {
	static readonly layer = Layer.effect(Grok, Grok.make).pipe(
		Layer.provide(Settings.layer),
	);
}
