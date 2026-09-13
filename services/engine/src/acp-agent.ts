/// <reference types="bun" />
import {
	type Client,
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
	type SessionConfigSelectGroup,
	type SessionConfigSelectOption,
	type SessionUpdate,
} from '@agentclientprotocol/sdk';
import { Context, Duration, Effect, Layer, RcRef, Schema } from 'effect';

type AcpEnv =
	| Record<string, string | undefined>
	| (() => Record<string, string | undefined>);

export type AcpAgentConfig = {
	binary: string;
	args: readonly string[];
	clientInfoName: string;
	env?: AcpEnv;
	extensionHandlers?: Record<string, (params: unknown) => Promise<unknown>>;
};

export class AcpSessionError extends Schema.TaggedError<AcpSessionError>()(
	'AcpSessionError',
	{ cause: Schema.Defect() },
) {
	override get message() {
		return String(this.cause);
	}
}

export class AcpTurnFailed extends Schema.TaggedError<AcpTurnFailed>()(
	'AcpTurnFailed',
	{
		code: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.Defect(),
	},
) {}

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

export function createAcpConnection(config: {
	binary: string;
	args: readonly string[];
	clientInfoName: string;
	env?: AcpEnv;
	extensionHandlers?: Record<string, (params: unknown) => Promise<unknown>>;
}) {
	return Effect.gen(function* () {
		const subprocess = yield* Effect.acquireRelease(
			Effect.sync(() => {
				const transform = new TransformStream<Uint8Array, Uint8Array>();
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
				});
				return { transform, proc };
			}),
			(resources) =>
				Effect.sync(() => {
					resources.proc.kill();
				}),
		);

		const stream = ndJsonStream(
			subprocess.transform.writable,
			subprocess.proc.stdout,
		);

		const listeners = new Map<string, (e: SessionUpdate) => void>();
		const extNotificationHandlers = new Map<
			string,
			(method: string, params: unknown) => void
		>();

		const registerListener = (
			sessionId: string,
			fn: (e: SessionUpdate) => void,
		) => {
			listeners.set(sessionId, fn);
			return () => {
				listeners.delete(sessionId);
			};
		};

		const conn = new ClientSideConnection(
			(): Client => ({
				sessionUpdate: async (params) => {
					const listener = listeners.get(params.sessionId);
					if (listener !== undefined) {
						listener(params.update);
					}
				},
				requestPermission: async (params) => {
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
						const h = extNotificationHandlers.get(sid);
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
					},
					clientInfo: { name: config.clientInfoName, version: '0.1.0' },
				}),
			catch: (cause) => new AcpSessionError({ cause }),
		});
		const agentInfo =
			initializeResponse.agentInfo === null
				? undefined
				: initializeResponse.agentInfo;

		return { conn, registerListener, extNotificationHandlers, agentInfo };
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
				agentName: agentInfo === undefined ? undefined : agentInfo.name,
				agentVersion: agentInfo === undefined ? undefined : agentInfo.version,
			};
		}),
	);
}

export function runAcpTurn(
	env: {
		conn: ClientSideConnection;
		registerListener: (
			sessionId: string,
			fn: (e: SessionUpdate) => void,
		) => () => void;
		extNotificationHandlers: Map<
			string,
			(method: string, params: unknown) => void
		>;
	},
	input: {
		prompt: string;
		model?: string;
		reasoningEffort?: string;
		sessionId?: string;
		cwd: string;
		onEvent?: (event: SessionUpdate) => void;
		onExtensionEvent?: (method: string, params: unknown) => void;
		skipModelSet?: boolean;
		configOptions?: ReadonlyArray<AcpConfigOption>;
	},
) {
	return Effect.gen(function* () {
		const sessionResult = yield* (() => {
			if (input.sessionId !== undefined) {
				const sid = input.sessionId;
				return Effect.tryPromise({
					try: () =>
						env.conn.loadSession({
							sessionId: sid,
							cwd: input.cwd,
							mcpServers: [],
						}),
					catch: (cause) => new AcpSessionError({ cause }),
				}).pipe(
					Effect.map((res) => ({
						sessionId: sid,
						availableModels:
							res.models === undefined || res.models === null
								? undefined
								: res.models.availableModels.map((m) => m.modelId),
					})),
				);
			}
			return Effect.tryPromise({
				try: () => env.conn.newSession({ cwd: input.cwd, mcpServers: [] }),
				catch: (cause) => new AcpSessionError({ cause }),
			}).pipe(
				Effect.map((res) => ({
					sessionId: res.sessionId,
					availableModels:
						res.models === undefined || res.models === null
							? undefined
							: res.models.availableModels.map((m) => m.modelId),
				})),
			);
		})();

		let buffer = '';

		const unregister = env.registerListener(
			sessionResult.sessionId,
			(update) => {
				if (input.onEvent !== undefined) {
					input.onEvent(update);
				}
				if (
					update.sessionUpdate === 'agent_message_chunk' &&
					update.content.type === 'text'
				) {
					buffer += update.content.text;
				}
			},
		);

		if (input.onExtensionEvent !== undefined) {
			env.extNotificationHandlers.set(
				sessionResult.sessionId,
				input.onExtensionEvent,
			);
		}

		const cleanup = Effect.sync(() => {
			unregister();
			env.extNotificationHandlers.delete(sessionResult.sessionId);
		});

		const response = yield* Effect.gen(function* () {
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
			for (const configOption of configOptions) {
				yield* Effect.tryPromise({
					try: () =>
						env.conn.setSessionConfigOption({
							sessionId: sessionResult.sessionId,
							configId: configOption.configId,
							value: configOption.value,
						}),
					catch: (cause) => {
						const rpcMessage = (() => {
							if (typeof cause === 'object' && cause !== null) {
								const c = cause as Record<string, unknown>;
								if (typeof c.data === 'object' && c.data !== null) {
									const d = c.data as Record<string, unknown>;
									if (typeof d.message === 'string') {
										return d.message;
									}
								}
								if (typeof c.message === 'string') {
									return c.message;
								}
							}
							return undefined;
						})();

						const modelsHint =
							sessionResult.availableModels !== undefined &&
							sessionResult.availableModels.length > 0
								? ` — available models: ${sessionResult.availableModels.slice(0, 10).join(', ')}`
								: '';

						const message =
							rpcMessage !== undefined
								? `${rpcMessage}${modelsHint}`
								: `setConfigOption failed${modelsHint}`;

						return new AcpTurnFailed({
							code: 'SET_CONFIG_OPTION',
							message,
							cause,
						});
					},
				});
			}

			return yield* Effect.tryPromise({
				try: (signal) => {
					const onAbort = () => {
						void env.conn.cancel({
							sessionId: sessionResult.sessionId,
						});
					};
					signal.addEventListener('abort', onAbort, {
						once: true,
					});
					return env.conn
						.prompt({
							sessionId: sessionResult.sessionId,
							prompt: [{ type: 'text', text: input.prompt }],
						})
						.finally(() => {
							signal.removeEventListener('abort', onAbort);
						});
				},
				catch: (cause) =>
					new AcpTurnFailed({
						code: 'PROMPT_REJECTED',
						message: 'prompt rejected',
						cause,
					}),
			});
		}).pipe(Effect.ensuring(cleanup));

		return {
			sessionId: sessionResult.sessionId,
			text: buffer,
			stopReason: response.stopReason,
		};
	});
}

/** How long a backend's ACP subprocess stays alive after its last turn finishes. */
const IDLE_TIME_TO_LIVE = Duration.minutes(5);
const MODEL_LIST_TIMEOUT_MS = 15_000;

export type AcpConfigOption = {
	configId: string;
	value: string;
};

export function makeAcpAgent(config: AcpAgentConfig) {
	return Effect.gen(function* () {
		// Non-spawning: RcRef only records how to acquire the connection.
		// The subprocess is spawned on the first `RcRef.get`, and killed
		// once the ref count drops to zero and stays there for
		// `IDLE_TIME_TO_LIVE`.
		const connectionRef = yield* RcRef.make({
			acquire: createAcpConnection(config),
			idleTimeToLive: IDLE_TIME_TO_LIVE,
		});

		const runTurn = (input: {
			prompt: string;
			model?: string;
			reasoningEffort?: string;
			sessionId?: string;
			cwd: string;
			onEvent?: (event: SessionUpdate) => void;
			onExtensionEvent?: (method: string, params: unknown) => void;
			configOptions?: ReadonlyArray<AcpConfigOption>;
		}) =>
			Effect.scoped(
				Effect.gen(function* () {
					const env = yield* RcRef.get(connectionRef);
					return yield* runAcpTurn(env, input);
				}),
			);

		// Model listing does NOT go through the shared, ref-counted
		// connection: it spins up its own throwaway connection (scoped to
		// this call only, killed right after) so that listing models
		// never spawns/holds the persistent backend harness.
		const listModels = (): Effect.Effect<
			ReadonlyArray<{ id: string }>,
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

					const availableModels =
						res.models !== undefined && res.models !== null
							? res.models.availableModels
							: [];
					if (availableModels.length > 0) {
						return availableModels.map((m) => ({ id: m.modelId }));
					}

					const modelOption = res.configOptions?.find(
						(opt) => opt.id === 'model',
					);
					if (modelOption === undefined || modelOption.type !== 'select') {
						return [];
					}

					return extractModelIds(modelOption.options);
				}),
			).pipe(
				Effect.timeout(MODEL_LIST_TIMEOUT_MS),
				Effect.mapError((cause) =>
					cause instanceof AcpSessionError
						? cause
						: new AcpSessionError({ cause }),
				),
			);

		return { runTurn, listModels };
	});
}

export class AcpAgent extends Context.Service<AcpAgent>()('oagent/AcpAgent', {
	make: makeAcpAgent,
}) {
	static readonly layer = (config: AcpAgentConfig) =>
		Layer.effect(AcpAgent, makeAcpAgent(config));
}
