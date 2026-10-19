/// <reference types="bun" />
import {
	type Client,
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
	type SessionConfigOption,
	type SessionConfigSelectGroup,
	type SessionConfigSelectOption,
	type SessionUpdate,
} from '@agentclientprotocol/sdk';
import {
	Context,
	Duration,
	Effect,
	Exit,
	Layer,
	RcRef,
	Schema,
	Scope,
} from 'effect';
import {
	NativeSubagentRouter,
	rewriteNativeSubagentMessage,
	SUBAGENT_META_KEY,
} from './acp-native-subagents.ts';
import {
	type AcpTurnEnvironment,
	AcpTurnFailed,
	type AcpTurnRecovery,
	createAcpTurnRecovery,
} from './acp-turn-recovery.ts';
import {
	type BackgroundHold,
	type BackgroundTaskRegistry,
	createBackgroundTaskRegistry,
	makeBackgroundHold,
} from './claude-background-tasks.ts';
import type { Backend, HarnessCheckResult } from './harness.ts';

type AcpEnv =
	| Record<string, string | undefined>
	| (() => Record<string, string | undefined>);

const killProcessGroup = (pid: number) =>
	Effect.try({
		try: () => process.kill(-pid, 'SIGKILL'),
		catch: (cause) => cause,
	}).pipe(
		Effect.catch((cause) =>
			typeof cause === 'object' &&
			cause !== null &&
			'code' in cause &&
			cause.code === 'ESRCH'
				? Effect.void
				: Effect.logWarning('Could not kill ACP process group', cause),
		),
		Effect.asVoid,
	);

export type AcpAgentConfig = {
	binary: string;
	args: readonly string[];
	clientInfoName: string;
	env?: AcpEnv;
	extensionHandlers?: Record<string, (params: unknown) => Promise<unknown>>;
	/** Advertises native subagent sessions, which the adapter reports per child. */
	nativeSubagents?: boolean;
	/** How long the subprocess outlives its last turn; defaults to five minutes. */
	idleTimeToLive?: Duration.Input;
};

export type { AcpTurnRecovery, TurnCompletion } from './acp-turn-recovery.ts';
export { AcpTurnFailed } from './acp-turn-recovery.ts';

export class AcpSessionError extends Schema.TaggedError<AcpSessionError>()(
	'AcpSessionError',
	{ cause: Schema.Defect() },
) {
	override get message() {
		return String(this.cause);
	}
}

type AcpConnection = {
	conn: ClientSideConnection;
	registerListener: (
		sessionId: string,
		fn: (e: SessionUpdate) => void,
	) => () => void;
	extNotificationHandlers: Map<
		string,
		(method: string, params: unknown) => void
	>;
	agentInfo:
		| Exclude<
				Awaited<ReturnType<ClientSideConnection['initialize']>>['agentInfo'],
				null
		  >
		| undefined;
	agentCapabilities: Awaited<
		ReturnType<ClientSideConnection['initialize']>
	>['agentCapabilities'];
	/** Whether the adapter advertised the `_session/steering` extension. */
	steeringSupported: boolean;
	/** Claude background task state per ACP session, fed by raw SDK messages. */
	backgroundTasks: BackgroundTaskRegistry;
	processExited: Promise<number>;
	close: () => void;
	cancelPermissions: (sessionId: string) => void;
};

export class AcpSteerError extends Schema.TaggedError<AcpSteerError>()(
	'AcpSteerError',
	{
		code: Schema.Literals([
			'NOT_RUNNING',
			'UNSUPPORTED_VERSION',
			'DELIVERY_FAILED',
		]),
		message: Schema.String,
		cause: Schema.Defect(),
	},
) {}

export class AcpForkNotSupportedError extends Schema.TaggedError<AcpForkNotSupportedError>()(
	'AcpForkNotSupportedError',
	{},
) {
	override get message() {
		return 'The ACP agent does not advertise session/fork support.';
	}
}

function getRpcMessage(cause: unknown): string | undefined {
	if (typeof cause !== 'object' || cause === null) return undefined;
	const error = cause as Record<string, unknown>;
	if (typeof error.data === 'object' && error.data !== null) {
		const data = error.data as Record<string, unknown>;
		if (typeof data.message === 'string') return data.message;
	}
	return typeof error.message === 'string' ? error.message : undefined;
}

function isSelectGroup(
	opt: SessionConfigSelectOption | SessionConfigSelectGroup,
): opt is SessionConfigSelectGroup {
	return 'group' in opt;
}

function extractModelIds(
	opts: Array<SessionConfigSelectOption> | Array<SessionConfigSelectGroup>,
): Array<{ id: string }> {
	const ids: Array<{ id: string }> = [];
	for (const item of opts) {
		if (isSelectGroup(item)) {
			for (const o of item.options) {
				ids.push({ id: o.value });
			}
		} else {
			ids.push({ id: item.value });
		}
	}
	return ids;
}

export function extractSelectOptions(
	configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
	configId: string,
): ReadonlyArray<{ value: string; label: string }> {
	if (configOptions === undefined || configOptions === null) return [];
	const option = configOptions.find((entry) => entry.id === configId);
	if (option === undefined || option.type !== 'select') return [];

	const choices: Array<{ value: string; label: string }> = [];
	for (const item of option.options) {
		if (isSelectGroup(item)) {
			for (const grouped of item.options) {
				choices.push({ value: grouped.value, label: grouped.name });
			}
			continue;
		}
		choices.push({ value: item.value, label: item.name });
	}
	return choices;
}

function extractSessionModelIds(
	configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
): ReadonlyArray<string> | undefined {
	const modelOption =
		configOptions?.find((option) => option.category === 'model') ??
		configOptions?.find((option) => option.id === 'model');
	if (modelOption === undefined || modelOption.type !== 'select') {
		return undefined;
	}
	return extractModelIds(modelOption.options).map((model) => model.id);
}

export type AcpModeOption = {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
};

export type AcpSessionCatalog = {
	readonly models: ReadonlyArray<{ id: string }>;
	readonly modes: ReadonlyArray<AcpModeOption>;
};

export type AcpConfigOption = {
	configId: string;
	value: string;
};

type AcpTurnSessionResult = {
	readonly sessionId: string;
	readonly availableModels: ReadonlyArray<string> | undefined;
	readonly availableModes: ReadonlyArray<AcpModeOption>;
};

function extractModeOptions(
	configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
): ReadonlyArray<AcpModeOption> {
	if (configOptions === undefined || configOptions === null) return [];
	const modeOption = configOptions.find((option) => option.id === 'mode');
	if (modeOption === undefined || modeOption.type !== 'select') return [];

	const modes: Array<AcpModeOption> = [];
	for (const item of modeOption.options) {
		const options = isSelectGroup(item) ? item.options : [item];
		for (const option of options) {
			modes.push({
				id: option.value,
				name: option.name,
				...(option.description === undefined || option.description === null
					? {}
					: { description: option.description }),
			});
		}
	}
	return modes;
}

function getConfigOptionHint(
	configOption: AcpConfigOption,
	sessionResult: AcpTurnSessionResult,
): string | undefined {
	if (configOption.configId === 'mode') {
		if (sessionResult.availableModes.length === 0) return undefined;
		return ` — available modes: ${sessionResult.availableModes
			.slice(0, 10)
			.map((mode) => mode.id)
			.join(', ')}`;
	}

	if (configOption.configId === 'model') {
		if (
			sessionResult.availableModels === undefined ||
			sessionResult.availableModels.length === 0
		) {
			return undefined;
		}
		return ` — available models: ${sessionResult.availableModels.slice(0, 10).join(', ')}`;
	}

	return undefined;
}

function isSteeringSupported(initializeResponse: {
	_meta?: { [key: string]: unknown } | null;
}): boolean {
	const steering = initializeResponse._meta?.steering;
	return (
		typeof steering === 'object' &&
		steering !== null &&
		'supported' in steering &&
		steering.supported === true
	);
}

const STEERING_METHOD = '_session/steering';

export function createAcpConnection(
	config: AcpAgentConfig,
): Effect.Effect<AcpConnection, AcpSessionError, Scope.Scope> {
	return Effect.gen(function* () {
		const subprocess = yield* Effect.acquireRelease(
			Effect.sync(() => {
				const transport = {
					controller: undefined as
						| TransformStreamDefaultController<Uint8Array>
						| undefined,
				};
				const transform = new TransformStream<Uint8Array, Uint8Array>({
					start: (controller) => {
						transport.controller = controller;
					},
				});
				const configuredEnv =
					config.env === undefined
						? undefined
						: typeof config.env === 'function'
							? config.env()
							: config.env;
				const env =
					configuredEnv === undefined
						? undefined
						: { ...process.env, ...configuredEnv };
				const proc = Bun.spawn([config.binary, ...config.args], {
					stdin: transform.readable,
					stdout: 'pipe',
					stderr: 'inherit',
					cwd: process.cwd(),
					env,
					detached: true,
				});
				return { transform, proc, transport };
			}),
			(resources) =>
				Effect.gen(function* () {
					yield* Effect.sync(() => resources.transport.controller?.terminate());
					yield* Effect.tryPromise({
						try: () => resources.proc.exited,
						catch: (cause) => cause,
					}).pipe(
						Effect.timeoutOption(3_000),
						Effect.catch((cause) =>
							Effect.logWarning('ACP exit wait failed', cause),
						),
					);
					yield* killProcessGroup(resources.proc.pid);
				}),
		);

		const wireStream = ndJsonStream(
			subprocess.transform.writable,
			subprocess.proc.stdout,
		);
		const stream =
			config.nativeSubagents === true
				? {
						writable: wireStream.writable,
						readable: wireStream.readable.pipeThrough(
							new TransformStream({
								transform: (message, controller) => {
									controller.enqueue(rewriteNativeSubagentMessage(message));
								},
							}),
						),
					}
				: wireStream;

		const listeners = new Map<string, (e: SessionUpdate) => void>();
		const cancelledSessions = new Set<string>();
		const subagents = new NativeSubagentRouter((sessionId) =>
			listeners.has(sessionId),
		);
		const extNotificationHandlers = new Map<
			string,
			(method: string, params: unknown) => void
		>();
		const backgroundTasks = createBackgroundTaskRegistry();

		const registerListener = (
			sessionId: string,
			fn: (e: SessionUpdate) => void,
		) => {
			listeners.set(sessionId, fn);
			cancelledSessions.delete(sessionId);
			return () => {
				listeners.delete(sessionId);
			};
		};

		const conn = new ClientSideConnection(
			(): Client => ({
				sessionUpdate: async (params) => {
					const routed = subagents.route(params.sessionId, params.update);
					if (routed === undefined) return;
					// Tracked even with no turn listening: a follow-up cycle can launch shells.
					if (!isSubagentUpdate(routed.update)) {
						backgroundTasks.observeUpdate(routed.rootSessionId, routed.update);
					}
					listeners.get(routed.rootSessionId)?.(routed.update);
				},
				requestPermission: async (params) => {
					if (cancelledSessions.has(subagents.rootOf(params.sessionId)))
						return { outcome: { outcome: 'cancelled' } };
					const allowAlways = params.options.find(
						(opt) => opt.kind === 'allow_always',
					);
					if (allowAlways !== undefined) {
						return {
							outcome: {
								outcome: 'selected',
								optionId: allowAlways.optionId,
							},
						};
					}
					const allowOnce = params.options.find(
						(opt) => opt.kind === 'allow_once',
					);
					if (allowOnce !== undefined) {
						return {
							outcome: {
								outcome: 'selected',
								optionId: allowOnce.optionId,
							},
						};
					}
					return { outcome: { outcome: 'cancelled' } };
				},

				extMethod: async (method, params) => {
					const handler = config.extensionHandlers?.[method];
					if (handler !== undefined) {
						return (await handler(params)) as Record<string, unknown>;
					}
					throw new Error(`Unhandled extension method: ${method}`);
				},
				extNotification: async (method, params) => {
					const sid =
						typeof params === 'object' && params !== null
							? (params as Record<string, unknown>).sessionId
							: undefined;
					if (typeof sid === 'string') {
						// Tracked even with no turn listening: a shell can end between turns.
						backgroundTasks.observe(subagents.rootOf(sid), method, params);
						const h = extNotificationHandlers.get(subagents.rootOf(sid));
						if (h !== undefined) {
							h(method, params);
							return;
						}
					}
					if (extNotificationHandlers.size === 1) {
						const h = extNotificationHandlers.values().next().value;
						if (h !== undefined) {
							h(method, params);
						}
					}
				},
			}),
			stream,
		);

		const initializeResponse = yield* Effect.tryPromise({
			try: () =>
				conn.initialize({
					protocolVersion: PROTOCOL_VERSION,
					clientCapabilities: {
						terminal: false,
						...(config.nativeSubagents === true ? { subagents: {} } : {}),
					},
					clientInfo: { name: config.clientInfoName, version: '0.1.0' },
				}),
			catch: (cause) => new AcpSessionError({ cause }),
		});
		const agentInfo =
			initializeResponse.agentInfo === null
				? undefined
				: initializeResponse.agentInfo;

		return {
			conn,
			registerListener,
			extNotificationHandlers,
			agentInfo,
			agentCapabilities: initializeResponse.agentCapabilities,
			steeringSupported: isSteeringSupported(initializeResponse),
			backgroundTasks,
			processExited: subprocess.proc.exited,
			close: () => {
				Effect.runSync(killProcessGroup(subprocess.proc.pid));
			},
			cancelPermissions: (sessionId: string) => {
				cancelledSessions.add(sessionId);
			},
		};
	});
}

export type AcpProbeInfo = {
	agentName?: string;
	agentVersion?: string;
};

/** Performs the ACP handshake and disposes the subprocess when it completes. */
export function probeAcpConnection(
	config: AcpAgentConfig,
	timeoutMs = 15_000,
): Effect.Effect<AcpProbeInfo, AcpSessionError, never> {
	return Effect.scoped(
		Effect.gen(function* () {
			const connection = yield* createAcpConnection(config).pipe(
				Effect.timeout(timeoutMs),
				Effect.mapError((cause) =>
					cause instanceof AcpSessionError
						? cause
						: new AcpSessionError({ cause }),
				),
			);
			const agentInfo = connection.agentInfo;
			return {
				agentName:
					agentInfo === undefined || agentInfo === null
						? undefined
						: agentInfo.name,
				agentVersion:
					agentInfo === undefined || agentInfo === null
						? undefined
						: agentInfo.version,
			};
		}),
	);
}

export function checkAcpConnection(
	backend: Backend,
	config: AcpAgentConfig,
): Effect.Effect<HarnessCheckResult, never, never> {
	return probeAcpConnection(config).pipe(
		Effect.map((info) => ({ backend, ok: true as const, ...info })),
		Effect.catchTag('AcpSessionError', (error) =>
			Effect.succeed({
				backend,
				ok: false as const,
				message: error.message,
			}),
		),
	);
}

/** Whether the update came from a subagent, by native session or by its tool call. */
function isSubagentUpdate(update: SessionUpdate): boolean {
	const meta = update._meta;
	if (meta === undefined || meta === null) return false;
	if (SUBAGENT_META_KEY in meta) return true;
	const claudeCode = meta.claudeCode;
	if (typeof claudeCode !== 'object' || claudeCode === null) return false;
	const parentToolUseId = (claudeCode as Record<string, unknown>)
		.parentToolUseId;
	if (typeof parentToolUseId !== 'string') return false;
	return !('toolCallId' in update) || update.toolCallId !== parentToolUseId;
}

/** What a turn exposes so a caller can end its background hold. */
type ActiveBackgroundHold = Pick<BackgroundHold, 'holdable' | 'release'>;

const NO_BACKGROUND_HOLD: ActiveBackgroundHold = {
	holdable: () => false,
	release: Effect.succeed(false),
};

type TextCapture = { buffer: string; afterToolCall: boolean };

function captureText(capture: TextCapture, update: SessionUpdate): void {
	if (update.sessionUpdate === 'tool_call') {
		capture.afterToolCall = true;
	}
	if (
		update.sessionUpdate === 'agent_message_chunk' &&
		update.content.type === 'text'
	) {
		if (capture.afterToolCall) {
			capture.buffer = '';
			capture.afterToolCall = false;
		}
		capture.buffer += update.content.text;
	}
}

export type BackgroundTaskHoldOptions = {
	maxHoldMs: number;
	/** How long to wait for the follow-up cycle to start before giving up on it. */
	followUpStartMs?: number;
	/** How long the SDK must stay idle after a follow-up cycle before the hold ends. */
	settleMs?: number;
};

export function runAcpTurn(
	env: AcpTurnEnvironment,
	input: {
		prompt: string;
		model?: string;
		reasoningEffort?: string;
		mode?: string;
		setUnlistedMode?: (input: {
			sessionId: string;
			mode: string;
		}) => Effect.Effect<void, AcpTurnFailed>;
		beforePrompt?: (sessionId: string) => Effect.Effect<void, AcpTurnFailed>;
		sessionId?: string;
		cwd: string;
		onSessionId?: (sessionId: string) => void;
		onEvent?: (event: SessionUpdate) => void;
		onExtensionEvent?: (method: string, params: unknown) => void;
		onPromptDispatch?: () => void;
		/**
		 * Called once the turn's ACP session exists. `currentConnection` follows
		 * mid-turn reconnects; the returned function is called when the turn ends.
		 */
		onTurnActive?: (
			sessionId: string,
			currentConnection: () => AcpTurnEnvironment,
			backgroundHold: ActiveBackgroundHold,
		) => () => void;
		/**
		 * Keeps the turn open after `end_turn` while background shell tasks run,
		 * so their autonomous follow-up cycle is recorded into the same turn.
		 * Needs raw SDK messages enabled in `sessionMeta` (Claude adapter only).
		 * `maxHoldMs` caps the hold; the turn then ends with its current text.
		 */
		backgroundTasks?: BackgroundTaskHoldOptions;
		skipModelSet?: boolean;
		configOptions?: ReadonlyArray<AcpConfigOption>;
		sessionMeta?: Record<string, unknown>;
		recovery?: AcpTurnRecovery;
	},
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const turnState = {
				main: { buffer: '', afterToolCall: false } as TextCapture,
				/** Text of the turn's follow-up cycles; it replaces the pre-hold answer only once complete. */
				followUp: undefined as TextCapture | undefined,
			};
			const backgroundHold =
				input.backgroundTasks === undefined
					? undefined
					: yield* makeBackgroundHold;
			if (backgroundHold !== undefined) {
				yield* Effect.addFinalizer(() => Effect.sync(backgroundHold.close));
			}
			const recoveryController = yield* createAcpTurnRecovery({
				env,
				cwd: input.cwd,
				sessionMeta: input.sessionMeta,
				initialSessionLoad: input.sessionId !== undefined,
				recovery: input.recovery,
				onEvent: (update) => {
					if (input.onEvent !== undefined) input.onEvent(update);
					// Subagent output must not become the turn's result text.
					if (isSubagentUpdate(update)) return;
					captureText(turnState.followUp ?? turnState.main, update);
				},
				onExtensionEvent: input.onExtensionEvent,
			});

			const turn = Effect.gen(function* () {
				const sessionResult: AcpTurnSessionResult = yield* (() => {
					if (input.sessionId !== undefined) {
						const sid = input.sessionId;
						return recoveryController.loadSession(sid).pipe(
							Effect.map((res) => ({
								sessionId: sid,
								availableModels: extractSessionModelIds(res.configOptions),
								availableModes: extractModeOptions(res.configOptions),
							})),
						);
					}
					return Effect.tryPromise({
						try: () =>
							env.conn.newSession({
								cwd: input.cwd,
								mcpServers: [],
								_meta: input.sessionMeta,
							}),
						catch: (cause) => new AcpSessionError({ cause }),
					})
						.pipe(
							Effect.map((res) => ({
								sessionId: res.sessionId,
								availableModels: extractSessionModelIds(res.configOptions),
								availableModes: extractModeOptions(res.configOptions),
							})),
						)
						.pipe(
							Effect.tap((res) =>
								Effect.sync(() => recoveryController.attach(res.sessionId)),
							),
						);
				})();

				const onSessionId = input.onSessionId;
				if (onSessionId !== undefined) {
					yield* Effect.sync(() => onSessionId(sessionResult.sessionId));
				}
				const onTurnActive = input.onTurnActive;
				if (onTurnActive !== undefined) {
					const unregister = onTurnActive(
						sessionResult.sessionId,
						recoveryController.currentConnection,
						backgroundHold === undefined ? NO_BACKGROUND_HOLD : backgroundHold,
					);
					yield* Effect.addFinalizer(() => Effect.sync(unregister));
				}
				if (input.beforePrompt !== undefined) {
					yield* input.beforePrompt(sessionResult.sessionId);
				}

				const configOptions: ReadonlyArray<AcpConfigOption> =
					input.skipModelSet === true
						? []
						: input.configOptions !== undefined
							? input.configOptions
							: [
									...(input.model !== undefined
										? [{ configId: 'model', value: input.model }]
										: []),
									...(input.reasoningEffort !== undefined
										? [
												{
													configId: 'reasoning_effort',
													value: input.reasoningEffort,
												},
											]
										: []),
								];
				const requestedMode =
					configOptions.find((option) => option.configId === 'mode')?.value ??
					input.mode;
				const setConfigOption = (configOption: AcpConfigOption) =>
					Effect.tryPromise({
						try: () =>
							recoveryController
								.currentConnection()
								.conn.setSessionConfigOption({
									sessionId: sessionResult.sessionId,
									configId: configOption.configId,
									value: configOption.value,
								}),
						catch: (cause) => {
							const rpcMessage = getRpcMessage(cause);

							const optionHint = getConfigOptionHint(
								configOption,
								sessionResult,
							);

							const detail =
								rpcMessage !== undefined
									? rpcMessage
									: 'setConfigOption failed';
							const message =
								optionHint === undefined ? detail : `${detail}${optionHint}`;

							return new AcpTurnFailed({
								code: 'SET_CONFIG_OPTION',
								message,
								cause,
							});
						},
					});
				for (const configOption of configOptions) {
					if (configOption.configId === 'mode') continue;
					yield* setConfigOption(configOption);
				}
				if (requestedMode !== undefined) {
					const modeIsListed = sessionResult.availableModes.some(
						(mode) => mode.id === requestedMode,
					);
					if (
						sessionResult.availableModes.length > 0 &&
						!modeIsListed &&
						input.setUnlistedMode !== undefined
					) {
						yield* input.setUnlistedMode({
							sessionId: sessionResult.sessionId,
							mode: requestedMode,
						});
					} else {
						yield* setConfigOption({ configId: 'mode', value: requestedMode });
					}
				}

				if (input.backgroundTasks !== undefined) {
					env.backgroundTasks?.forSession(sessionResult.sessionId).beginTurn();
				}
				const response = yield* recoveryController.runPrompt(
					input.prompt,
					input.onPromptDispatch,
				);
				if (
					backgroundHold !== undefined &&
					input.backgroundTasks !== undefined &&
					response.stopReason === 'end_turn'
				) {
					// A reconnect swaps the connection, and with it the task state.
					const connection = recoveryController.currentConnection();
					if (connection.backgroundTasks === undefined) {
						return yield* Effect.die(
							new Error('Background task holding needs a connection tracker'),
						);
					}
					const tracker = connection.backgroundTasks.forSession(
						sessionResult.sessionId,
					);
					backgroundHold.markHoldable(tracker);
					if (yield* tracker.hasLiveTurnShellsAfterFlush) {
						const followUp: TextCapture = { buffer: '', afterToolCall: false };
						turnState.followUp = followUp;
						yield* backgroundHold.hold({
							settle: {
								followUpStartMs:
									input.backgroundTasks.followUpStartMs ??
									BACKGROUND_FOLLOW_UP_START_MS,
								settleMs:
									input.backgroundTasks.settleMs ?? BACKGROUND_SETTLE_MS,
							},
							maxHoldMs: input.backgroundTasks.maxHoldMs,
							processExited: connection.processExited,
							cancel: recoveryController.cancel,
						});
						// A cycle cut off mid-run would leave a partial answer.
						if (!tracker.isCycleRunning() && followUp.buffer !== '') {
							turnState.main.buffer = followUp.buffer;
						}
					}
				}
				return { sessionResult, response };
			}).pipe(Effect.ensuring(recoveryController.cleanup));

			const completed = yield* turn;
			return {
				sessionId: completed.sessionResult.sessionId,
				text: turnState.main.buffer,
				stopReason: completed.response.stopReason,
			};
		}),
	);
}

export function forkAcpSession(
	env: {
		conn: ClientSideConnection;
		agentCapabilities:
			| Awaited<
					ReturnType<ClientSideConnection['initialize']>
			  >['agentCapabilities']
			| undefined;
	},
	input: { sessionId: string; cwd: string },
): Effect.Effect<
	{ sessionId: string },
	AcpForkNotSupportedError | AcpSessionError,
	never
> {
	return Effect.gen(function* () {
		const sessionCapabilities = env.agentCapabilities?.sessionCapabilities;
		const forkCapability = sessionCapabilities?.fork;
		if (forkCapability === undefined || forkCapability === null) {
			return yield* new AcpForkNotSupportedError({});
		}
		return yield* Effect.tryPromise({
			try: () =>
				env.conn
					.unstable_forkSession({
						sessionId: input.sessionId,
						cwd: input.cwd,
						mcpServers: [],
					})
					.then((response) => ({ sessionId: response.sessionId })),
			catch: (cause) => new AcpSessionError({ cause }),
		});
	});
}

/** How long a backend's ACP subprocess stays alive after its last turn finishes. */
const DEFAULT_IDLE_TIME_TO_LIVE = Duration.minutes(5);
const BACKGROUND_FOLLOW_UP_START_MS = 10_000;
// Only bridges two follow-up cycles queued back to back, so it stays short.
const BACKGROUND_SETTLE_MS = 1_000;
const SESSION_CATALOG_TIMEOUT_MS = 15_000;
const MODEL_CONFIG_CHOICES_TIMEOUT_MS = 15_000;

export function makeAcpAgent(config: AcpAgentConfig) {
	return Effect.gen(function* () {
		const agentScope = yield* Effect.scope;
		// Non-spawning: RcRef only records how to acquire the connection.
		// The subprocess is spawned on the first `RcRef.get`, and killed
		// once the ref count drops to zero and stays there for
		// `idleTimeToLive`.
		const cached = { connection: undefined as AcpConnection | undefined };
		const connectionRef: RcRef.RcRef<AcpConnection, AcpSessionError> =
			yield* RcRef.make({
				acquire: Effect.gen(function* () {
					const connection = yield* createAcpConnection(config);
					cached.connection = connection;
					// A harness that dies between turns would otherwise stay cached
					// and fail every later turn. The identity check keeps a stale
					// watcher (e.g. after a mid-turn reconnect) from evicting a
					// newer connection.
					yield* Effect.promise(() => connection.conn.closed).pipe(
						Effect.andThen(
							Effect.suspend(() =>
								cached.connection === connection
									? RcRef.invalidate(connectionRef)
									: Effect.void,
							),
						),
						Effect.forkScoped,
					);
					return connection;
				}),
				idleTimeToLive: config.idleTimeToLive ?? DEFAULT_IDLE_TIME_TO_LIVE,
			});

		// Killing the process group would kill a background shell that outlived its
		// turn, so the connection stays referenced until the shells end. The cap,
		// measured from the turn's end, keeps a shell that never ends from pinning
		// the process forever.
		const keepConnectionWhileShellsRun = (
			backgroundTasks: BackgroundTaskRegistry,
			connectionScope: Scope.Closeable,
			maxKeepAliveMs: number | undefined,
		) =>
			Effect.suspend(() =>
				maxKeepAliveMs !== undefined && backgroundTasks.hasLiveShells()
					? backgroundTasks.untilNoLiveShells.pipe(
							Effect.timeoutOption(Duration.millis(maxKeepAliveMs)),
							Effect.ensuring(Scope.close(connectionScope, Exit.void)),
							Effect.forkIn(agentScope),
							Effect.asVoid,
						)
					: Scope.close(connectionScope, Exit.void),
			);

		const activeTurns = new Map<
			string,
			{
				currentConnection: () => AcpTurnEnvironment;
				backgroundHold: ActiveBackgroundHold;
			}
		>();

		const runTurn = (input: {
			prompt: string;
			model?: string;
			reasoningEffort?: string;
			mode?: string;
			setUnlistedMode?: (input: {
				sessionId: string;
				mode: string;
			}) => Effect.Effect<void, AcpTurnFailed>;
			beforePrompt?: (sessionId: string) => Effect.Effect<void, AcpTurnFailed>;
			sessionId?: string;
			cwd: string;
			onSessionId?: (sessionId: string) => void;
			onEvent?: (event: SessionUpdate) => void;
			onExtensionEvent?: (method: string, params: unknown) => void;
			onPromptDispatch?: () => void;
			configOptions?: ReadonlyArray<AcpConfigOption>;
			sessionMeta?: Record<string, unknown>;
			recovery?: AcpTurnRecovery;
			backgroundTasks?: BackgroundTaskHoldOptions;
		}) =>
			Effect.uninterruptibleMask((restore) =>
				Effect.gen(function* () {
					// The turn's connection reference lives in its own scope so a
					// background shell can keep the process alive after the turn.
					const connectionScope = yield* Scope.make();
					const env = yield* restore(
						RcRef.get(connectionRef).pipe(Scope.provide(connectionScope)),
					).pipe(Effect.onError(() => Scope.close(connectionScope, Exit.void)));
					return yield* restore(
						runAcpTurn(
							{
								...env,
								createConnection: () => createAcpConnection(config),
								onReconnect: () => RcRef.invalidate(connectionRef),
							},
							{
								...input,
								onTurnActive: (
									sessionId,
									currentConnection,
									backgroundHold,
								) => {
									const active = { currentConnection, backgroundHold };
									activeTurns.set(sessionId, active);
									return () => {
										// A newer turn may have taken over the id before this one unwinds.
										if (activeTurns.get(sessionId) === active) {
											activeTurns.delete(sessionId);
										}
									};
								},
							},
						),
					).pipe(
						Effect.ensuring(
							keepConnectionWhileShellsRun(
								env.backgroundTasks,
								connectionScope,
								input.backgroundTasks?.maxHoldMs,
							),
						),
					);
				}),
			);

		const steer = (input: { sessionId: string; text: string }) =>
			Effect.gen(function* () {
				const activeTurn = activeTurns.get(input.sessionId);
				if (activeTurn === undefined) {
					return yield* new AcpSteerError({
						code: 'NOT_RUNNING',
						message: `No turn is running for ACP session ${input.sessionId}.`,
						cause: new Error('No active ACP turn'),
					});
				}
				// The prompt already returned, so there is no turn to steer into. The
				// caller releases the hold and starts a fresh turn instead.
				if (activeTurn.backgroundHold.holdable()) {
					return yield* new AcpSteerError({
						code: 'NOT_RUNNING',
						message: `The turn for ACP session ${input.sessionId} has finished and is only waiting for background tasks.`,
						cause: new Error('ACP turn is in a background hold'),
					});
				}
				const connection = activeTurn.currentConnection();
				if (connection.steeringSupported !== true) {
					const info = connection.agentInfo;
					const agent =
						info === undefined
							? config.clientInfoName
							: `${info.name} ${info.version}`;
					return yield* new AcpSteerError({
						code: 'UNSUPPORTED_VERSION',
						message: `The ${agent} ACP adapter does not support steering; upgrade it.`,
						cause: new Error('ACP adapter did not advertise steering'),
					});
				}
				const result = yield* Effect.tryPromise({
					try: () =>
						connection.conn.extMethod(STEERING_METHOD, {
							sessionId: input.sessionId,
							prompt: [{ type: 'text', text: input.text }],
							// Without the opt-in an idle session would start a detached turn.
							_meta: { steering: { idleBehavior: 'promptRequired' } },
						}),
					catch: (cause) =>
						new AcpSteerError({
							code: 'DELIVERY_FAILED',
							message: getRpcMessage(cause) ?? 'Steering request failed.',
							cause,
						}),
				});
				if (result.outcome === 'promptRequired') {
					return yield* new AcpSteerError({
						code: 'NOT_RUNNING',
						message: `No turn is running for ACP session ${input.sessionId}.`,
						cause: new Error('Adapter reported promptRequired'),
					});
				}
				if (result.outcome !== 'injected') {
					return yield* new AcpSteerError({
						code: 'DELIVERY_FAILED',
						message: `Unexpected steering outcome: ${JSON.stringify(result.outcome)}`,
						cause: new Error('Unexpected steering outcome'),
					});
				}
				return { messageId: crypto.randomUUID(), text: input.text };
			});

		const releaseHold = (input: { sessionId: string }) =>
			Effect.suspend(() => {
				const activeTurn = activeTurns.get(input.sessionId);
				return activeTurn === undefined
					? Effect.succeed(false)
					: activeTurn.backgroundHold.release;
			});

		const forkSession = (input: { sessionId: string; cwd: string }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const env = yield* RcRef.get(connectionRef);
					return yield* forkAcpSession(env, input);
				}),
			);

		// Catalog listing does NOT go through the shared, ref-counted
		// connection: it spins up its own throwaway connection (scoped to
		// this call only, killed right after) so that discovery
		// never spawns/holds the persistent backend harness.
		const listSessionCatalog = (): Effect.Effect<
			AcpSessionCatalog,
			AcpSessionError,
			never
		> =>
			Effect.scoped(
				Effect.gen(function* () {
					const env = yield* createAcpConnection(config);
					const res = yield* Effect.tryPromise({
						try: () =>
							env.conn.newSession({ cwd: process.cwd(), mcpServers: [] }),
						catch: (cause) => new AcpSessionError({ cause }),
					});

					const modelIds = extractSessionModelIds(res.configOptions);
					const models =
						modelIds === undefined ? [] : modelIds.map((id) => ({ id }));

					return {
						models,
						modes: extractModeOptions(res.configOptions),
					};
				}),
			).pipe(
				Effect.timeout(SESSION_CATALOG_TIMEOUT_MS),
				Effect.mapError((cause) =>
					cause instanceof AcpSessionError
						? cause
						: new AcpSessionError({ cause }),
				),
			);

		const listModels = () =>
			listSessionCatalog().pipe(Effect.map((catalog) => catalog.models));

		// Config options such as reasoning effort can depend on the selected model,
		// so the choices are read from the session's response to selecting it.
		const listModelConfigChoices = (input: {
			model: string;
			configId: string;
		}): Effect.Effect<
			ReadonlyArray<{ value: string; label: string }>,
			AcpSessionError,
			never
		> =>
			Effect.scoped(
				Effect.gen(function* () {
					const env = yield* createAcpConnection(config);
					const session = yield* Effect.tryPromise({
						try: () =>
							env.conn.newSession({ cwd: process.cwd(), mcpServers: [] }),
						catch: (cause) => new AcpSessionError({ cause }),
					});
					const response = yield* Effect.tryPromise({
						try: () =>
							env.conn.setSessionConfigOption({
								sessionId: session.sessionId,
								configId: 'model',
								value: input.model,
							}),
						catch: (cause) => new AcpSessionError({ cause }),
					});
					return extractSelectOptions(response.configOptions, input.configId);
				}),
			).pipe(
				Effect.timeout(MODEL_CONFIG_CHOICES_TIMEOUT_MS),
				Effect.mapError((cause) =>
					cause instanceof AcpSessionError
						? cause
						: new AcpSessionError({ cause }),
				),
			);

		return {
			runTurn,
			steer,
			releaseHold,
			forkSession,
			listModels,
			listSessionCatalog,
			listModelConfigChoices,
		};
	});
}

export class AcpAgent extends Context.Service<AcpAgent>()('oagent/AcpAgent', {
	make: makeAcpAgent,
}) {
	static readonly layer = (config: AcpAgentConfig) =>
		Layer.effect(AcpAgent, makeAcpAgent(config));
}
