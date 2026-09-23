import type {
	ClientSideConnection,
	SessionUpdate,
} from '@agentclientprotocol/sdk';
import { Effect, Schema, Semaphore } from 'effect';
import type { Scope } from 'effect/Scope';
import { createAcpTurnReplay } from './acp-turn-replay.ts';

export class AcpTurnFailed extends Schema.TaggedError<AcpTurnFailed>()(
	'AcpTurnFailed',
	{
		code: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.Defect(),
	},
) {}

export type AcpTurnRecovery = {
	isSessionBusy: (
		sessionId: string,
	) => Effect.Effect<boolean, AcpTurnFailed, never>;
	stallTimeoutMs?: number;
	pollIntervalMs?: number;
	maxRetries?: number;
};

export type AcpTurnConnection = {
	conn: ClientSideConnection;
	registerListener: (
		sessionId: string,
		fn: (event: SessionUpdate) => void,
	) => () => void;
	extNotificationHandlers: Map<
		string,
		(method: string, params: unknown) => void
	>;
	processExited?: Promise<number>;
	close?: () => void;
};

export type AcpTurnEnvironment = AcpTurnConnection & {
	createConnection?: () => Effect.Effect<AcpTurnConnection, unknown, Scope>;
	onReconnect?: () => Effect.Effect<void, never, never>;
};

type PromptResponse = Awaited<ReturnType<ClientSideConnection['prompt']>>;
type LoadSessionResponse = Awaited<
	ReturnType<ClientSideConnection['loadSession']>
>;

type AcpTurnRecoveryInput = {
	env: AcpTurnEnvironment;
	cwd: string;
	initialSessionLoad: boolean;
	recovery?: AcpTurnRecovery;
	onEvent: (event: SessionUpdate) => void;
	onExtensionEvent?: (method: string, params: unknown) => void;
};

export type AcpTurnRecoveryController = {
	attach: (sessionId: string, includeExtensions?: boolean) => void;
	loadSession: (
		sessionId: string,
	) => Effect.Effect<LoadSessionResponse, AcpTurnFailed, Scope>;
	currentConnection: () => AcpTurnEnvironment;
	runPrompt: (
		prompt: string,
		onPromptDispatch?: () => void,
	) => Effect.Effect<PromptResponse, AcpTurnFailed, Scope>;
	cleanup: Effect.Effect<void, never, never>;
};

function getRpcMessage(cause: unknown): string | undefined {
	if (typeof cause !== 'object' || cause === null) return undefined;
	const error = cause as Record<string, unknown>;
	if (typeof error.data === 'object' && error.data !== null) {
		const data = error.data as Record<string, unknown>;
		if (typeof data.message === 'string') return data.message;
	}
	return typeof error.message === 'string' ? error.message : undefined;
}

function formatSessionLoadError(sessionId: string, cause: unknown): string {
	const rpcMessage = getRpcMessage(cause);
	const detail = rpcMessage === undefined ? '' : `: ${rpcMessage}`;
	return `Could not load OpenCode session "${sessionId}"${detail}. It may no longer exist or belong to a different backend; start without sessionId.`;
}

export function createAcpTurnRecovery(
	input: AcpTurnRecoveryInput,
): Effect.Effect<AcpTurnRecoveryController, never, never> {
	return Effect.gen(function* () {
		const recoverySemaphore = yield* Semaphore.make(1);
		const state = {
			current: input.env,
			sessionId: undefined as string | undefined,
			unregister: () => {},
			eventCount: 0,
			lastEventAt: Date.now(),
			promptDispatched: false,
			reconnected: false,
			recoveryAttempts: 0,
		};
		const connections: Array<AcpTurnConnection> = [];

		const appendEvent = (event: SessionUpdate): void => {
			state.eventCount += 1;
			state.lastEventAt = Date.now();
			input.onEvent(event);
		};
		const replay = createAcpTurnReplay({
			initialLoad: input.initialSessionLoad,
			onEvent: appendEvent,
		});
		const onEvent = (event: SessionUpdate): void => replay.observe(event);

		const attach = (
			connection: AcpTurnConnection,
			sessionId: string,
			includeExtensions = true,
		): void => {
			state.unregister();
			state.current = connection;
			state.sessionId = sessionId;
			const unregister = connection.registerListener(sessionId, onEvent);
			if (includeExtensions && input.onExtensionEvent !== undefined) {
				connection.extNotificationHandlers.set(
					sessionId,
					input.onExtensionEvent,
				);
			}
			state.unregister = () => {
				unregister();
				if (includeExtensions && input.onExtensionEvent !== undefined) {
					connection.extNotificationHandlers.delete(sessionId);
				}
			};
		};

		const recovery = input.recovery;
		const createConnection = input.env.createConnection;
		const maxRecoveryRetries = recovery?.maxRetries ?? 3;
		const recoveryPollInterval = recovery?.pollIntervalMs ?? 2_000;
		const recoveryStallTimeout = recovery?.stallTimeoutMs ?? 15_000;
		const recoveryRetryDelay = 1_000;
		const recoverySettleTimeout =
			Math.max(recoveryStallTimeout, recoveryPollInterval) *
			(maxRecoveryRetries + 1);

		const recoveryFailure = (message: string, cause: unknown): AcpTurnFailed =>
			new AcpTurnFailed({
				code: 'ACP_RECOVERY_FAILED',
				message,
				cause,
			});

		const reconnectOnce = (
			reason: string,
			expected?: AcpTurnConnection,
		): Effect.Effect<void, AcpTurnFailed, Scope> => {
			if (recovery === undefined || createConnection === undefined) {
				return Effect.fail(
					recoveryFailure(
						`ACP connection for session ${state.sessionId} cannot be recovered because no recovery strategy is configured.`,
						new Error('Missing ACP recovery strategy'),
					),
				);
			}
			return recoverySemaphore.withPermit(
				Effect.gen(function* () {
					if (expected !== undefined && state.current !== expected) return;
					if (state.recoveryAttempts >= maxRecoveryRetries) {
						return yield* recoveryFailure(
							`Could not restore the ACP connection for session ${state.sessionId} after ${maxRecoveryRetries} attempts; the job is stopping instead of remaining running.`,
							new Error('ACP recovery retry limit reached'),
						);
					}
					const sessionId = state.sessionId;
					if (sessionId === undefined) {
						return yield* recoveryFailure(
							'Cannot recover an ACP turn before its session ID is available.',
							new Error('Missing ACP session ID'),
						);
					}

					state.recoveryAttempts += 1;
					const attempt = state.recoveryAttempts;
					yield* Effect.logInfo(
						`ACP reconnect attempt ${attempt}/${maxRecoveryRetries} for session ${sessionId} (${reason})`,
					);
					const previous = state.current;
					if (input.env.onReconnect !== undefined) {
						yield* input.env.onReconnect();
					}
					const next = yield* createConnection().pipe(
						Effect.mapError((cause) =>
							recoveryFailure(
								`Could not create a replacement ACP connection for session ${sessionId}.`,
								cause,
							),
						),
					);
					connections.push(next);
					const beforeEvents = state.eventCount;
					replay.beginReplay();
					attach(next, sessionId);
					const load = Effect.tryPromise({
						try: () =>
							next.conn.loadSession({
								sessionId,
								cwd: input.cwd,
								mcpServers: [],
							}),
						catch: (cause) =>
							recoveryFailure(
								`Could not reload OpenCode session ${sessionId} after reconnecting.`,
								cause,
							),
					});
					yield* load.pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								replay.completeReplay();
							}),
						),
						Effect.tapError(() =>
							Effect.sync(() => {
								replay.failReplay();
								next.close?.();
								attach(previous, sessionId);
							}),
						),
					);
					state.lastEventAt = Date.now();
					state.reconnected = true;
					yield* Effect.logInfo(
						`Back-filled ${state.eventCount - beforeEvents} ACP events for session ${sessionId} after reconnect`,
					);
				}),
			);
		};

		const reconnect = (
			reason: string,
			expected?: AcpTurnConnection,
		): Effect.Effect<void, AcpTurnFailed, Scope> => {
			if (expected === undefined && state.reconnected) return Effect.void;
			return reconnectOnce(reason, expected).pipe(
				Effect.catch((error) => {
					if (state.recoveryAttempts >= maxRecoveryRetries) {
						return Effect.fail(error);
					}
					return Effect.sleep(recoveryRetryDelay).pipe(
						Effect.flatMap(() => reconnect(reason, expected)),
					);
				}),
			);
		};

		const waitForRecoveredCompletion = (): Effect.Effect<
			PromptResponse,
			AcpTurnFailed,
			never
		> => {
			if (recovery === undefined) {
				return Effect.fail(
					recoveryFailure(
						`The ACP prompt for session ${state.sessionId} ended without a recovery strategy.`,
						new Error('Missing ACP recovery strategy'),
					),
				);
			}
			return Effect.gen(function* () {
				const sessionId = state.sessionId;
				if (sessionId === undefined) {
					return yield* recoveryFailure(
						'The ACP prompt ended before its session ID was available.',
						new Error('Missing ACP session ID'),
					);
				}
				const deadline = Date.now() + recoverySettleTimeout;
				while (true) {
					const busy = yield* recovery.isSessionBusy(sessionId);
					if (!busy) return { stopReason: 'end_turn' as const };
					if (Date.now() >= deadline) {
						return yield* recoveryFailure(
							`OpenCode session ${sessionId} stayed busy after reconnecting; the job is stopping instead of remaining running.`,
							new Error('Recovered ACP session did not become idle'),
						);
					}
					yield* Effect.sleep(recoveryPollInterval);
				}
			});
		};

		const invokePrompt = (
			prompt: string,
			onPromptDispatch?: () => void,
		): Effect.Effect<PromptResponse, AcpTurnFailed, never> =>
			Effect.tryPromise({
				try: async (signal) => {
					const connection = state.current;
					const sessionId = state.sessionId;
					if (sessionId === undefined) {
						throw new Error('Missing ACP session ID');
					}
					const onAbort = () => {
						void connection.conn.cancel({ sessionId });
					};
					signal.addEventListener('abort', onAbort, { once: true });
					try {
						const promptRequest = connection.conn.prompt({
							sessionId,
							prompt: [{ type: 'text', text: prompt }],
						});
						state.promptDispatched = true;
						state.lastEventAt = Date.now();
						if (onPromptDispatch !== undefined) onPromptDispatch();
						return await promptRequest;
					} finally {
						signal.removeEventListener('abort', onAbort);
					}
				},
				catch: (cause) =>
					new AcpTurnFailed({
						code: 'PROMPT_REJECTED',
						message: 'prompt rejected',
						cause,
					}),
			});

		const runPrompt = (
			prompt: string,
			onPromptDispatch?: () => void,
		): Effect.Effect<PromptResponse, AcpTurnFailed, Scope> => {
			const promptEffect = invokePrompt(prompt, onPromptDispatch).pipe(
				Effect.catch((error) => {
					if (
						!state.promptDispatched ||
						recovery === undefined ||
						createConnection === undefined
					) {
						return Effect.fail(error);
					}
					return Effect.gen(function* () {
						if (!state.reconnected) {
							yield* reconnect('prompt request failed');
						}
						return yield* waitForRecoveredCompletion();
					});
				}),
			);

			if (recovery === undefined || createConnection === undefined) {
				return promptEffect;
			}

			const monitor = Effect.gen(function* () {
				const sessionId = state.sessionId;
				if (sessionId === undefined) {
					return yield* recoveryFailure(
						'Cannot monitor an ACP turn before its session ID is available.',
						new Error('Missing ACP session ID'),
					);
				}
				while (true) {
					const observed = state.current;
					const processExited = observed.processExited;
					const signal =
						processExited === undefined
							? yield* Effect.sleep(recoveryPollInterval).pipe(
									Effect.as('poll' as const),
								)
							: yield* Effect.raceFirst(
									Effect.tryPromise({
										try: () => processExited,
										catch: (cause) => cause,
									}).pipe(Effect.as('closed' as const), Effect.orDie),
									Effect.sleep(recoveryPollInterval).pipe(
										Effect.as('poll' as const),
									),
								);
					if (!state.promptDispatched) continue;

					const closed = signal === 'closed';
					const stalled =
						Date.now() - state.lastEventAt >= recoveryStallTimeout;
					if (!closed && !stalled) continue;

					if (!closed) {
						const busy = yield* recovery.isSessionBusy(sessionId);
						if (!busy) {
							state.lastEventAt = Date.now();
							continue;
						}
					}

					yield* reconnect(
						closed
							? 'ACP process or transport closed'
							: 'session stalled while busy',
						observed,
					);
					const busy = yield* recovery.isSessionBusy(sessionId);
					if (!busy) return { stopReason: 'end_turn' as const };
				}
			});

			return Effect.raceFirst(promptEffect, monitor);
		};

		return {
			attach: (sessionId, includeExtensions = true) => {
				attach(input.env, sessionId, includeExtensions);
			},
			loadSession: (sessionId) => {
				attach(input.env, sessionId, false);
				return Effect.tryPromise({
					try: () =>
						input.env.conn.loadSession({
							sessionId,
							cwd: input.cwd,
							mcpServers: [],
						}),
					catch: (cause) =>
						new AcpTurnFailed({
							code: 'SESSION_LOAD_FAILED',
							message: formatSessionLoadError(sessionId, cause),
							cause,
						}),
				}).pipe(
					Effect.tap(() =>
						Effect.sync(() => {
							attach(input.env, sessionId);
							replay.finishInitialLoad();
						}),
					),
				);
			},
			currentConnection: () => state.current,
			runPrompt,
			cleanup: Effect.sync(() => {
				state.unregister();
				for (const connection of connections) {
					connection.close?.();
				}
			}),
		};
	});
}
