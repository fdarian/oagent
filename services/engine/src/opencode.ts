import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { Context, Effect, Layer, Ref, Schema, Semaphore } from 'effect';
import {
	AcpAgent,
	type AcpAgentConfig,
	type AcpConfigOption,
	AcpSessionError,
	createAcpConnection,
} from './acp-agent.ts';
import { HarnessVersion } from './harness-version.ts';
import {
	OpenCodeServiceClient,
	type OpenCodeServiceDiscoveryError,
	type OpenCodeSteerRequestError,
} from './opencode-service-client.ts';
import { Settings } from './settings.ts';

const OPENCODE_BINARY = 'opencode';
const OPENCODE_EFFORT_CONFIG_ID = 'effort';
const OPENCODE_EFFORTS_TIMEOUT_MS = 15_000;
const OPENCODE_VERSION_TIMEOUT_MS = 15_000;
const OPENCODE_VERSION_PATTERN =
	/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/;

export type OpenCodeEffortOption = {
	value: string;
	label: string;
};

export class OpenCodeSteerNotSupportedError extends Schema.TaggedError<OpenCodeSteerNotSupportedError>()(
	'OpenCodeSteerNotSupportedError',
	{ version: Schema.String },
) {
	override get message() {
		return `Steering is not supported by opencode ${this.version}; opencode v2 or newer is required.`;
	}
}

type OpenCodeService = AcpAgent['Service'] & {
	listModelEfforts: (
		model: string,
	) => Effect.Effect<
		ReadonlyArray<OpenCodeEffortOption>,
		AcpSessionError,
		never
	>;
	requireSteerSupport: () => Effect.Effect<
		string,
		AcpSessionError | OpenCodeSteerNotSupportedError,
		never
	>;
	steer: (input: {
		sessionId: string;
		text: string;
	}) => Effect.Effect<
		void,
		| AcpSessionError
		| OpenCodeSteerNotSupportedError
		| OpenCodeServiceDiscoveryError
		| OpenCodeSteerRequestError,
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
	const command = Effect.scoped(
		Effect.gen(function* () {
			const proc = yield* Effect.acquireRelease(
				Effect.try({
					try: () =>
						Bun.spawn([binary, '--version'], {
							stdout: 'pipe',
							stderr: 'pipe',
						}),
					catch: (cause) => new AcpSessionError({ cause }),
				}),
				(child) =>
					Effect.sync(() => {
						if (child.exitCode === null) child.kill();
					}),
			);
			const output = yield* Effect.tryPromise({
				try: () =>
					Promise.all([
						new Response(proc.stdout).text(),
						new Response(proc.stderr).text(),
						proc.exited,
					]),
				catch: (cause) => new AcpSessionError({ cause }),
			});
			const stdout = output[0];
			const stderr = output[1];
			const exitCode = output[2];
			const combined = commandOutput(stdout, stderr);
			if (exitCode !== 0) {
				return yield* new AcpSessionError({
					cause: new Error(
						combined.length > 0
							? `opencode --version exited with code ${exitCode}: ${combined}`
							: `opencode --version exited with code ${exitCode}`,
					),
				});
			}
			const version = parseOpenCodeVersion(combined);
			if (version === undefined) {
				return yield* new AcpSessionError({
					cause: new Error(
						combined.length > 0
							? `Could not parse an opencode version from: ${combined}`
							: 'opencode --version returned no output',
					),
				});
			}
			return version;
		}),
	);
	return command.pipe(
		Effect.timeout(OPENCODE_VERSION_TIMEOUT_MS),
		Effect.mapError((cause) =>
			cause instanceof AcpSessionError ? cause : new AcpSessionError({ cause }),
		),
	);
}

function parseOpenCodeMajor(version: string): number | undefined {
	const match = /^(\d+)\./.exec(version);
	if (match === null) return undefined;
	const major = match[1];
	if (major === undefined) return undefined;
	return Number.parseInt(major, 10);
}

export function createOpenCodeAcpConfig(
	getExtraEnv?: () => Record<string, string>,
): AcpAgentConfig {
	return {
		binary: resolveOpenCodeBinary() ?? getOpenCodeBinary(),
		args: ['acp'] as const,
		clientInfoName: 'oagent',
		...(getExtraEnv === undefined
			? {}
			: { env: () => ({ ...process.env, ...getExtraEnv() }) }),
	};
}

const openCodeAcpLayer = Layer.unwrap(
	Effect.gen(function* () {
		const settings = yield* Settings;
		return AcpAgent.layer(
			createOpenCodeAcpConfig(() => settings.getHarnessEnv('opencode')),
		);
	}),
);

export class OpenCode extends Context.Service<OpenCode>()('oagent/OpenCode', {
	make: Effect.gen(function* () {
		const settings = yield* Settings;
		const acpAgent = yield* AcpAgent;
		const harnessVersion = yield* HarnessVersion;
		const serviceClient = yield* OpenCodeServiceClient;
		const binary = resolveOpenCodeBinary() ?? getOpenCodeBinary();
		const versionRef = yield* Ref.make<string | undefined>(undefined);
		const versionSemaphore = yield* Semaphore.make(1);

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

		const resolveVersion = () =>
			versionSemaphore.withPermit(
				Effect.gen(function* () {
					const memoized = yield* Ref.get(versionRef);
					if (memoized !== undefined) return memoized;
					const persisted = yield* harnessVersion
						.get('opencode')
						.pipe(Effect.mapError((cause) => new AcpSessionError({ cause })));
					if (persisted !== undefined) {
						yield* Ref.set(versionRef, persisted);
						return persisted;
					}
					const detected = yield* resolveOpenCodeVersion(binary);
					yield* harnessVersion
						.set('opencode', detected, binary)
						.pipe(Effect.mapError((cause) => new AcpSessionError({ cause })));
					yield* Ref.set(versionRef, detected);
					return detected;
				}),
			);

		const listModelsCli = () =>
			Effect.tryPromise({
				try: async () => {
					const proc = Bun.spawn([binary, 'models'], {
						stdout: 'pipe',
						stderr: 'pipe',
						env: { ...process.env, ...settings.getHarnessEnv('opencode') },
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

		const listModels = () =>
			Effect.gen(function* () {
				const version = yield* resolveVersion();
				const major = parseOpenCodeMajor(version);
				if (major !== undefined) {
					if (major >= 2) return yield* acpAgent.listModels();
					if (major === 1) return yield* listModelsCli();
				}
				return yield* new AcpSessionError({
					cause: new Error(`Unsupported opencode version: ${version}`),
				});
			});

		const requireSteerSupport = () =>
			Effect.gen(function* () {
				const version = yield* resolveVersion();
				const major = parseOpenCodeMajor(version);
				if (major === undefined || major < 2) {
					return yield* new OpenCodeSteerNotSupportedError({ version });
				}
				return version;
			});

		const steer = (input: { sessionId: string; text: string }) =>
			Effect.gen(function* () {
				yield* requireSteerSupport();
				yield* serviceClient.steer(binary, input);
			});

		const listModelEfforts = (model: string) =>
			Effect.scoped(
				Effect.gen(function* () {
					const connection = yield* createAcpConnection(
						createOpenCodeAcpConfig(() => settings.getHarnessEnv('opencode')),
					);
					const session = yield* Effect.tryPromise({
						try: () =>
							connection.conn.newSession({
								cwd: process.cwd(),
								mcpServers: [],
							}),
						catch: (cause) => new AcpSessionError({ cause }),
					});
					const response = yield* Effect.tryPromise({
						try: () =>
							connection.conn.setSessionConfigOption({
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
			requireSteerSupport,
			steer,
		} satisfies OpenCodeService;
	}),
}) {
	static readonly layer = Layer.effect(OpenCode, OpenCode.make).pipe(
		Layer.provide(openCodeAcpLayer),
		Layer.provide(HarnessVersion.layer),
		Layer.provide(OpenCodeServiceClient.layer),
		Layer.provide(Settings.layer),
	);
}
