import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { Context, Effect, Layer } from 'effect';
import {
	AcpAgent,
	type AcpAgentConfig,
	type AcpConfigOption,
	AcpSessionError,
	createAcpConnection,
} from './acp-agent.ts';

const OPENCODE_BINARY = 'opencode';
const OPENCODE_EFFORT_CONFIG_ID = 'effort';
const OPENCODE_EFFORTS_TIMEOUT_MS = 15_000;
const OPENCODE_VERSION_PATTERN =
	/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/;

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

function commandOutput(stdout: string, stderr: string): string {
	const parts = [stdout.trim(), stderr.trim()].filter(
		(part) => part.length > 0,
	);
	return parts.join('\n');
}

function parseOpenCodeVersion(output: string): string | undefined {
	const match = OPENCODE_VERSION_PATTERN.exec(output);
	if (match === null) return undefined;
	return match[1];
}

export function resolveOpenCodeVersion(
	binary: string,
): Effect.Effect<string, AcpSessionError> {
	return Effect.tryPromise({
		try: async () => {
			const proc = Bun.spawn([binary, '--version'], {
				stdout: 'pipe',
				stderr: 'pipe',
			});
			const output = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			const stdout = output[0];
			const stderr = output[1];
			const exitCode = output[2];
			const combined = commandOutput(stdout, stderr);
			if (exitCode !== 0) {
				throw new Error(
					combined.length > 0
						? `opencode --version exited with code ${exitCode}: ${combined}`
						: `opencode --version exited with code ${exitCode}`,
				);
			}
			const version = parseOpenCodeVersion(combined);
			if (version === undefined) {
				throw new Error(
					combined.length > 0
						? `Could not parse an opencode version from: ${combined}`
						: 'opencode --version returned no output',
				);
			}
			return version;
		},
		catch: (cause) => new AcpSessionError({ cause }),
	});
}

export function createOpenCodeAcpConfig(): AcpAgentConfig {
	return {
		binary: resolveOpenCodeBinary() ?? getOpenCodeBinary(),
		args: ['acp'] as const,
		clientInfoName: 'oagent',
	};
}

export class OpenCode extends Context.Service<OpenCode>()('oagent/OpenCode', {
	make: Effect.gen(function* () {
		const acpAgent = yield* AcpAgent;
		const binary = resolveOpenCodeBinary() ?? getOpenCodeBinary();

		const runTurn = (input: Parameters<typeof acpAgent.runTurn>[0]) =>
			acpAgent.runTurn({
				...input,
				model: undefined,
				reasoningEffort: undefined,
				configOptions: getOpenCodeConfigOptions(
					input.model,
					input.reasoningEffort,
				),
			});

		const listModels = () =>
			Effect.tryPromise({
				try: async () => {
					const proc = Bun.spawn([binary, 'models'], {
						stdout: 'pipe',
						stderr: 'pipe',
					});
					const output = await Promise.all([
						new Response(proc.stdout).text(),
						new Response(proc.stderr).text(),
						proc.exited,
					]);
					const stdout = output[0];
					const stderr = output[1];
					const exitCode = output[2];
					const detail = commandOutput(stdout, stderr);
					if (exitCode !== 0) {
						throw new Error(
							detail.length > 0
								? `opencode models exited with code ${exitCode}: ${detail}`
								: `opencode models exited with code ${exitCode}`,
						);
					}
					const ids = stdout
						.trim()
						.split('\n')
						.map((line) => line.trim())
						.filter((line) => line.length > 0);
					if (ids.length === 0) {
						throw new Error(
							detail.length > 0
								? `opencode models returned no models: ${detail}`
								: 'opencode models returned no models',
						);
					}
					const unexpected = ids.find((id) => !/^[^/\s]+\/\S+$/.test(id));
					if (unexpected !== undefined) {
						throw new Error(`Unexpected opencode model output: ${unexpected}`);
					}
					return ids.map((id) => ({ id }));
				},
				catch: (cause) => new AcpSessionError({ cause }),
			});

		const listModelEfforts = (model: string) =>
			Effect.scoped(
				Effect.gen(function* () {
					const env = yield* createAcpConnection(createOpenCodeAcpConfig());
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
		Layer.provide(AcpAgent.layer(createOpenCodeAcpConfig())),
	);
}
