import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { Context, Effect, Layer } from 'effect';
import {
	type AcpAgent,
	type AcpAgentConfig,
	type AcpConfigOption,
	AcpSessionError,
	createAcpConnection,
	makeAcpAgent,
} from './acp-agent.ts';
import { Settings } from './settings.ts';

const OPENCODE_BINARY = 'opencode';
const OPENCODE_EFFORT_CONFIG_ID = 'effort';
const OPENCODE_EFFORTS_TIMEOUT_MS = 15_000;

export type OpenCodeEffortOption = {
	value: string;
	label: string;
};

type OpenCodeService = AcpAgent['Service'] & {
	listModelEfforts: (
		model: string,
	) => Effect.Effect<
		ReadonlyArray<OpenCodeEffortOption>,
		AcpSessionError,
		never
	>;
};

function getOpenCodeConfigOptions(
	model: string | undefined,
	reasoningEffort: string | undefined,
): ReadonlyArray<AcpConfigOption> | undefined {
	const options: Array<AcpConfigOption> = [];
	if (model !== undefined) options.push({ configId: 'model', value: model });
	if (reasoningEffort !== undefined) {
		options.push({
			configId: OPENCODE_EFFORT_CONFIG_ID,
			value: reasoningEffort,
		});
	}
	return options.length === 0 ? undefined : options;
}

function getOpenCodeEffortOptions(
	configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
): ReadonlyArray<OpenCodeEffortOption> {
	if (configOptions === undefined || configOptions === null) return [];
	const effortOption = configOptions.find(
		(option) => option.id === OPENCODE_EFFORT_CONFIG_ID,
	);
	if (effortOption === undefined || effortOption.type !== 'select') return [];

	const efforts: Array<OpenCodeEffortOption> = [];
	for (const option of effortOption.options) {
		if ('group' in option) {
			for (const groupedOption of option.options) {
				efforts.push({
					value: groupedOption.value,
					label: groupedOption.name,
				});
			}
			continue;
		}
		efforts.push({ value: option.value, label: option.name });
	}
	return efforts;
}

export function getOpenCodeBinary(): string {
	return process.env.OAGENT_OPENCODE_BIN ?? OPENCODE_BINARY;
}

export function resolveOpenCodeBinary(): string | undefined {
	return Bun.which(getOpenCodeBinary()) ?? undefined;
}

export function createOpenCodeAcpConfig(
	extraEnv: Record<string, string> = {},
): AcpAgentConfig {
	return {
		binary: resolveOpenCodeBinary() ?? getOpenCodeBinary(),
		args: ['acp'] as const,
		clientInfoName: 'oagent',
		...(Object.keys(extraEnv).length > 0
			? { env: () => ({ ...process.env, ...extraEnv }) }
			: {}),
	};
}

export class OpenCode extends Context.Service<OpenCode>()('oagent/OpenCode', {
	make: Effect.gen(function* () {
		const settings = yield* Settings;
		const extraEnv: Record<string, string> = {};
		const acpAgent = yield* makeAcpAgent({
			...createOpenCodeAcpConfig(extraEnv),
			env: () => ({ ...process.env, ...extraEnv }),
		});
		const binary = resolveOpenCodeBinary() ?? getOpenCodeBinary();

		const refreshHarnessEnv = () =>
			Effect.gen(function* () {
				const configuredEnv = yield* settings
					.getHarnessEnv('opencode')
					.pipe(Effect.mapError((cause) => new AcpSessionError({ cause })));
				yield* Effect.sync(() => {
					for (const key of Object.keys(extraEnv)) delete extraEnv[key];
					Object.assign(extraEnv, configuredEnv);
				});
			});

		const runTurn = (input: Parameters<typeof acpAgent.runTurn>[0]) =>
			Effect.gen(function* () {
				yield* refreshHarnessEnv();
				return yield* acpAgent.runTurn({
					...input,
					model: undefined,
					reasoningEffort: undefined,
					configOptions: getOpenCodeConfigOptions(
						input.model,
						input.reasoningEffort,
					),
				});
			});

		const listModels = () =>
			Effect.gen(function* () {
				yield* refreshHarnessEnv();
				return yield* Effect.tryPromise({
					try: async () => {
						const proc = Bun.spawn([binary, 'models'], {
							stdout: 'pipe',
						});
						const text = await new Response(proc.stdout).text();
						await proc.exited;
						return text
							.trim()
							.split('\n')
							.filter((line) => line.length > 0)
							.map((id) => ({ id }));
					},
					catch: (cause) => new AcpSessionError({ cause }),
				});
			});

		const listModelEfforts = (model: string) =>
			Effect.scoped(
				Effect.gen(function* () {
					const configuredEnv = yield* settings
						.getHarnessEnv('opencode')
						.pipe(Effect.mapError((cause) => new AcpSessionError({ cause })));
					const env = yield* createAcpConnection(
						createOpenCodeAcpConfig(configuredEnv),
					);
					const session = yield* Effect.tryPromise({
						try: () =>
							env.conn.newSession({
								cwd: process.cwd(),
								mcpServers: [],
							}),
						catch: (cause) => new AcpSessionError({ cause }),
					});
					const response = yield* Effect.tryPromise({
						try: () =>
							env.conn.setSessionConfigOption({
								sessionId: session.sessionId,
								configId: 'model',
								value: model,
							}),
						catch: (cause) => new AcpSessionError({ cause }),
					});
					return getOpenCodeEffortOptions(response.configOptions);
				}),
			).pipe(
				Effect.timeout(OPENCODE_EFFORTS_TIMEOUT_MS),
				Effect.mapError((cause) =>
					cause instanceof AcpSessionError
						? cause
						: new AcpSessionError({ cause }),
				),
			);

		return {
			runTurn,
			listModels,
			listModelEfforts,
		} satisfies OpenCodeService;
	}),
}) {
	static readonly layer = Layer.effect(OpenCode, OpenCode.make).pipe(
		Layer.provide(Settings.layer),
	);
}
