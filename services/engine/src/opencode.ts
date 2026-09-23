import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { Context, Effect, Layer, Ref, Schema, Semaphore } from 'effect';
import {
	AcpAgent,
	type AcpAgentConfig,
	type AcpConfigOption,
	type AcpSessionCatalog,
	AcpSessionError,
	AcpTurnFailed,
	type AcpTurnRecovery,
	checkAcpConnection,
	createAcpConnection,
} from './acp-agent.ts';
import { type Harness, HarnessSteerError } from './harness.ts';
import { ModelsCache } from './models-cache.ts';
import { OpenCodeServiceClient } from './opencode-service-client.ts';
import { Settings } from './settings.ts';

const OPENCODE_BINARY = 'opencode';
const OPENCODE_EFFORT_CONFIG_ID = 'effort';
const OPENCODE_API_TIMEOUT_MS = 15_000;
const OPENCODE_EFFORTS_TIMEOUT_MS = 15_000;
const OPENCODE_VERSION_TIMEOUT_MS = 15_000;
const OPENCODE_VERSION_PATTERN =
	/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/;

export type OpenCodeEffortOption = {
	value: string;
	label: string;
};

const OpenCodeAgentListResponse = Schema.fromJsonString(
	Schema.Struct({
		data: Schema.Array(
			Schema.Struct({
				id: Schema.String,
				name: Schema.String,
				description: Schema.optional(Schema.String),
				mode: Schema.Literals(['primary', 'subagent', 'all']),
				hidden: Schema.Boolean,
			}),
		),
	}),
);

type OpenCodeCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type VersionState = {
	loaded: boolean;
	value: string | undefined;
};

export class OpenCodeSteerNotSupportedError extends Schema.TaggedError<OpenCodeSteerNotSupportedError>()(
	'OpenCodeSteerNotSupportedError',
	{ version: Schema.String },
) {
	override get message() {
		return `Steering is not supported by opencode ${this.version}; opencode v2 or newer is required.`;
	}
}

type OpenCodeService = Harness & {
	listSessionCatalog: () => Effect.Effect<
		AcpSessionCatalog,
		AcpSessionError,
		never
	>;
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

function runOpenCodeApi(
	binary: string,
	args: ReadonlyArray<string>,
	env: Readonly<Record<string, string>>,
): Effect.Effect<string, AcpSessionError> {
	const command = Effect.scoped(
		Effect.gen(function* () {
			const proc = yield* Effect.acquireRelease(
				Effect.try({
					try: () =>
						Bun.spawn([binary, 'api', ...args], {
							stdin: 'ignore',
							stdout: 'pipe',
							stderr: 'pipe',
							env: { ...process.env, ...env },
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
			const result: OpenCodeCommandResult = {
				stdout: output[0],
				stderr: output[1],
				exitCode: output[2],
			};
			if (result.exitCode !== 0) {
				const detail = result.stderr.trim();
				return yield* new AcpSessionError({
					cause: new Error(
						detail.length === 0
							? `opencode api exited with code ${result.exitCode}`
							: `opencode api exited with code ${result.exitCode}: ${detail}`,
					),
				});
			}
			return result.stdout;
		}),
	);
	return command.pipe(
		Effect.timeout(OPENCODE_API_TIMEOUT_MS),
		Effect.mapError((cause) =>
			cause instanceof AcpSessionError ? cause : new AcpSessionError({ cause }),
		),
	);
}

function listOpenCodeAgents(
	binary: string,
	env: Readonly<Record<string, string>>,
	cwd: string,
): Effect.Effect<AcpSessionCatalog['modes'], AcpSessionError> {
	const location = `location.directory=${cwd}`;
	return Effect.gen(function* () {
		// OpenCode 2.0.9 can cache its ACP catalog before file agents load.
		// This API operation waits for the same location's plugins to activate.
		yield* runOpenCodeApi(
			binary,
			['integration.list', '--param', location],
			env,
		).pipe(
			Effect.catch((error) =>
				Effect.logDebug(
					`OpenCode agent activation preflight was unavailable: ${error.message}`,
				),
			),
		);
		const output = yield* runOpenCodeApi(
			binary,
			['agent.list', '--param', location],
			env,
		);
		const response = yield* Schema.decodeUnknownEffect(
			OpenCodeAgentListResponse,
		)(output).pipe(Effect.mapError((cause) => new AcpSessionError({ cause })));
		const modes = response.data
			.filter((agent) => agent.mode !== 'subagent' && !agent.hidden)
			.map((agent) => ({
				id: agent.id,
				name: agent.name,
				...(agent.description === undefined
					? {}
					: { description: agent.description }),
			}));
		if (modes.length === 0) {
			return yield* new AcpSessionError({
				cause: new Error('opencode api reported no selectable agents'),
			});
		}
		return modes;
	});
}

function switchOpenCodeAgent(
	binary: string,
	env: Readonly<Record<string, string>>,
	sessionId: string,
	agent: string,
): Effect.Effect<void, AcpSessionError> {
	return runOpenCodeApi(
		binary,
		[
			'session.switchAgent',
			'--param',
			`sessionID=${sessionId}`,
			'--data',
			JSON.stringify({ agent }),
		],
		env,
	).pipe(Effect.asVoid);
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
		const serviceClient = yield* OpenCodeServiceClient;
		const binary = resolveOpenCodeBinary() ?? getOpenCodeBinary();
		const createConfig = () =>
			createOpenCodeAcpConfig(() => settings.getHarnessEnv('opencode'));
		const check = () => checkAcpConnection('opencode', createConfig());
		const versionRef = yield* Ref.make<VersionState>({
			loaded: false,
			value: undefined,
		});
		const versionSemaphore = yield* Semaphore.make(1);

		// OpenCode 2.0.9 rejects custom agents omitted from its cached ACP catalog,
		// but its session API can persist the selection before the prompt starts.
		const selectUnlistedMode = (input: {
			sessionId: string;
			mode: string;
			cwd: string;
		}) =>
			Effect.gen(function* () {
				const env = settings.getHarnessEnv('opencode');
				const agents = yield* listOpenCodeAgents(binary, env, input.cwd);
				if (!agents.some((agent) => agent.id === input.mode)) {
					const available = agents
						.slice(0, 10)
						.map((agent) => agent.id)
						.join(', ');
					return yield* new AcpTurnFailed({
						code: 'SET_CONFIG_OPTION',
						message: `Unknown OpenCode agent "${input.mode}" — available modes: ${available}`,
						cause: new Error(`Unknown OpenCode agent: ${input.mode}`),
					});
				}
				yield* switchOpenCodeAgent(binary, env, input.sessionId, input.mode);
			}).pipe(
				Effect.mapError((cause) =>
					cause instanceof AcpTurnFailed
						? cause
						: new AcpTurnFailed({
								code: 'SET_CONFIG_OPTION',
								message: `Failed to select OpenCode agent "${input.mode}": ${cause.message}`,
								cause,
							}),
				),
			);

		const runTurn = (input: Parameters<typeof acpAgent.runTurn>[0]) =>
			acpAgent.runTurn({
				...input,
				model: undefined,
				reasoningEffort: undefined,
				configOptions: getOpenCodeConfigOptions(
					input.model,
					input.reasoningEffort,
				),
				setUnlistedMode: (mode) =>
					selectUnlistedMode({
						sessionId: mode.sessionId,
						mode: mode.mode,
						cwd: input.cwd,
					}),
				beforePrompt: (sessionId) =>
					serviceClient.disableQuestion(binary, sessionId).pipe(
						Effect.mapError(
							(cause) =>
								new AcpTurnFailed({
									code: 'SESSION_PERMISSION',
									message: `Failed to disable questions for OpenCode session "${sessionId}": ${cause.message}`,
									cause,
								}),
						),
					),
				recovery: {
					isSessionBusy: (sessionId) =>
						serviceClient.isSessionActive(binary, sessionId).pipe(
							Effect.mapError(
								(cause) =>
									new AcpTurnFailed({
										code: 'ACP_RECOVERY_STATUS_FAILED',
										message: cause.message,
										cause,
									}),
							),
						),
				} satisfies AcpTurnRecovery,
			});

		const forkSession = (input: { sessionId: string; cwd: string }) =>
			acpAgent.forkSession(input);

		const forkSessionBefore = (input: {
			sessionId: string;
			cwd: string;
			before: string;
		}) =>
			Effect.gen(function* () {
				yield* requireSteerSupport();
				return {
					sessionId: yield* serviceClient.forkSession(binary, input),
				};
			});

		const getLatestMessageId = (sessionId: string) =>
			serviceClient.getLatestMessageId(binary, sessionId);

		const getFirstMessageAfter = (input: {
			sessionId: string;
			messageId: string;
		}) => serviceClient.getFirstMessageAfter(binary, input);

		const version = () =>
			versionSemaphore.withPermit(
				Effect.gen(function* () {
					const memoized = yield* Ref.get(versionRef);
					if (memoized.loaded) return memoized.value;
					const detected = yield* resolveOpenCodeVersion(binary);
					yield* Ref.set(versionRef, { loaded: true, value: detected });
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

		const listSessionCatalog = (): Effect.Effect<
			AcpSessionCatalog,
			AcpSessionError,
			never
		> =>
			Effect.gen(function* () {
				const detectedVersion = yield* version();
				if (detectedVersion === undefined) {
					return yield* new AcpSessionError({
						cause: new Error('Could not detect an opencode version'),
					});
				}
				const major = parseOpenCodeMajor(detectedVersion);
				if (major !== undefined) {
					if (major >= 2) {
						const catalog = yield* acpAgent.listSessionCatalog();
						const modes = yield* listOpenCodeAgents(
							binary,
							settings.getHarnessEnv('opencode'),
							process.cwd(),
						).pipe(
							Effect.catch((error) =>
								Effect.logDebug(
									`Falling back to OpenCode ACP agent discovery: ${error.message}`,
								).pipe(Effect.as(catalog.modes)),
							),
						);
						return { models: catalog.models, modes };
					}
					if (major === 1) {
						const models = yield* listModelsCli();
						return { models, modes: [] };
					}
				}
				return yield* new AcpSessionError({
					cause: new Error(`Unsupported opencode version: ${detectedVersion}`),
				});
			});

		const fetchModels = () =>
			listSessionCatalog().pipe(Effect.map((catalog) => catalog.models));
		const fetchAgentTargets = () =>
			listSessionCatalog().pipe(
				Effect.map((catalog) =>
					catalog.modes.map((mode) => ({
						id: mode.id,
						label: mode.name,
						...(mode.description === undefined
							? {}
							: { description: mode.description }),
					})),
				),
			);

		const requireSteerSupport = () =>
			Effect.gen(function* () {
				const detectedVersion = yield* version();
				if (detectedVersion === undefined) {
					return yield* new AcpSessionError({
						cause: new Error('Could not detect an opencode version'),
					});
				}
				const major = parseOpenCodeMajor(detectedVersion);
				if (major === undefined || major < 2) {
					return yield* new OpenCodeSteerNotSupportedError({
						version: detectedVersion,
					});
				}
				return detectedVersion;
			});

		const steer = (input: { sessionId: string; text: string }) =>
			Effect.gen(function* () {
				yield* requireSteerSupport().pipe(
					Effect.mapError(
						(error) =>
							new HarnessSteerError({
								code:
									error instanceof OpenCodeSteerNotSupportedError
										? 'UNSUPPORTED_VERSION'
										: 'VERSION_CHECK_FAILED',
								message: error.message,
								cause: error,
							}),
					),
				);
				return yield* serviceClient.steer(binary, input).pipe(
					Effect.mapError(
						(error) =>
							new HarnessSteerError({
								code: 'DELIVERY_FAILED',
								message: error.message,
								cause: error,
							}),
					),
				);
			});

		const fetchModelEfforts = (model: string) =>
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
		const modelCache = yield* ModelsCache.make(() => fetchModels());
		const agentTargetCache = yield* ModelsCache.make(() => fetchAgentTargets());
		const effortCache = yield* ModelsCache.makeKeyed((model) =>
			fetchModelEfforts(model),
		);
		const listModels = () => modelCache.get();
		const listAgentTargets = () => agentTargetCache.get();
		const listModelEfforts = (model: string) => effortCache.get(model);
		const invalidate = () =>
			Effect.gen(function* () {
				yield* modelCache.invalidate();
				yield* agentTargetCache.invalidate();
				yield* effortCache.invalidate();
			});

		return {
			backend: 'opencode',
			runTurn,
			forkSession,
			forkSessionBefore,
			getLatestMessageId,
			getFirstMessageAfter,
			listModels,
			listSessionCatalog,
			listModelEfforts,
			listAgentTargets,
			resolveBinary: resolveOpenCodeBinary,
			version,
			invalidate,
			check,
			requireSteerSupport,
			steer,
		} satisfies OpenCodeService;
	}),
}) {
	static readonly layer = Layer.effect(OpenCode, OpenCode.make).pipe(
		Layer.provide(openCodeAcpLayer),
		Layer.provide(OpenCodeServiceClient.layer),
		Layer.provide(Settings.layer),
	);
}
