import { Context, Effect, Layer, Ref, Semaphore } from 'effect';
import {
	AcpAgent,
	type AcpAgentConfig,
	probeAcpConnection,
} from './acp-agent.ts';
import type { Harness } from './harness.ts';
import { ModelsCache } from './models-cache.ts';
import { Settings } from './settings.ts';

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

const CURSOR_BINARY = 'cursor-agent';

type VersionState = {
	loaded: boolean;
	value: string | undefined;
};

export function getCursorBinary(): string {
	return process.env.OAGENT_CURSOR_BIN ?? CURSOR_BINARY;
}

export function resolveCursorBinary(): string | undefined {
	return Bun.which(getCursorBinary()) ?? undefined;
}

export function createCursorAcpConfig(
	getExtraEnv?: () => Record<string, string>,
): AcpAgentConfig {
	return {
		binary: resolveCursorBinary() ?? getCursorBinary(),
		args: ['acp'] as const,
		clientInfoName: 'oagent',
		...(getExtraEnv === undefined
			? {}
			: { env: () => ({ ...process.env, ...getExtraEnv() }) }),
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
}

const cursorAcpLayer = Layer.unwrap(
	Effect.gen(function* () {
		const settings = yield* Settings;
		return AcpAgent.layer(
			createCursorAcpConfig(() => settings.getHarnessEnv('cursor')),
		);
	}),
);

export class Cursor extends Context.Service<Cursor>()('oagent/Cursor', {
	make: Effect.gen(function* () {
		const acpAgent = yield* AcpAgent;
		const settings = yield* Settings;
		const createConfig = () =>
			createCursorAcpConfig(() => settings.getHarnessEnv('cursor'));
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
				Effect.map((models) =>
					models.map((entry) => ({
						id: entry.id,
						label: CURSOR_ID_TO_LABEL.get(entry.id),
					})),
				),
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
			backend: 'cursor',
			runTurn: (input: Parameters<typeof acpAgent.runTurn>[0]) => {
				const model =
					input.model !== undefined && input.model in CURSOR_MODEL_ALIASES
						? CURSOR_MODEL_ALIASES[input.model]
						: input.model;
				return acpAgent.runTurn({ ...input, model });
			},
			listModels,
			listModelEfforts,
			resolveBinary: resolveCursorBinary,
			version,
			invalidate,
			createConfig,
		} satisfies Harness;
	}),
}) {
	static readonly layer = Layer.effect(Cursor, Cursor.make).pipe(
		Layer.provide(cursorAcpLayer),
		Layer.provide(Settings.layer),
	);
}
