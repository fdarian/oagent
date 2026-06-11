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
import { Effect, Schema } from 'effect';

export class AcpSessionError extends Schema.TaggedError<AcpSessionError>()(
	'AcpSessionError',
	{ cause: Schema.Defect },
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
		cause: Schema.Defect,
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
	extensionHandlers?: Record<string, (params: unknown) => Promise<unknown>>;
}) {
	return Effect.gen(function* () {
		const subprocess = yield* Effect.acquireRelease(
			Effect.sync(() => {
				const transform = new TransformStream<Uint8Array, Uint8Array>();
				const proc = Bun.spawn([config.binary, ...config.args], {
					stdin: transform.readable,
					stdout: 'pipe',
					stderr: 'inherit',
					cwd: process.cwd(),
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
				readTextFile: async (params) => {
					const text = await Bun.file(params.path).text();
					if (params.line !== undefined && params.line !== null) {
						const lines = text.split('\n');
						const start = Math.max(params.line - 1, 0);
						const end =
							params.limit !== undefined && params.limit !== null
								? start + params.limit
								: undefined;
						return { content: lines.slice(start, end).join('\n') };
					}
					return { content: text };
				},
				writeTextFile: async (params) => {
					await Bun.write(params.path, params.content);
					return {};
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

		yield* Effect.tryPromise({
			try: () =>
				conn.initialize({
					protocolVersion: PROTOCOL_VERSION,
					clientCapabilities: {
						fs: { readTextFile: true, writeTextFile: true },
						terminal: false,
					},
					clientInfo: { name: config.clientInfoName, version: '0.1.0' },
				}),
			catch: (cause) => new AcpSessionError({ cause }),
		});

		return { conn, registerListener, extNotificationHandlers };
	});
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
		sessionId?: string;
		cwd: string;
		onEvent?: (event: SessionUpdate) => void;
		onExtensionEvent?: (method: string, params: unknown) => void;
		skipModelSet?: boolean;
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
			const model = input.model;
			if (model !== undefined && input.skipModelSet !== true) {
				yield* Effect.tryPromise({
					try: () =>
						env.conn.setSessionConfigOption({
							sessionId: sessionResult.sessionId,
							configId: 'model',
							value: model,
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

export class AcpAgent extends Effect.Service<AcpAgent>()('oagent/AcpAgent', {
	effect: (config: {
		binary: string;
		args: readonly string[];
		clientInfoName: string;
		extensionHandlers?: Record<string, (params: unknown) => Promise<unknown>>;
	}) =>
		Effect.gen(function* () {
			const env = yield* createAcpConnection(config);

			const runTurn = (input: {
				prompt: string;
				model?: string;
				sessionId?: string;
				cwd: string;
				onEvent?: (event: SessionUpdate) => void;
				onExtensionEvent?: (method: string, params: unknown) => void;
			}) => runAcpTurn(env, input);

		const listModels = (): Effect.Effect<
			ReadonlyArray<{ id: string }>,
			AcpSessionError,
			never
		> =>
			Effect.tryPromise({
				try: () =>
					env.conn.newSession({ cwd: process.cwd(), mcpServers: [] }),
				catch: (cause) => new AcpSessionError({ cause }),
			}).pipe(
				Effect.map((res) => {
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
					if (
						modelOption === undefined ||
						modelOption.type !== 'select'
					) {
						return [];
					}

					return extractModelIds(modelOption.options);
				}),
			);

			return { runTurn, listModels };
		}),
}) {}
