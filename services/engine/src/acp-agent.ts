/// <reference types="bun" />
import {
	type Client,
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
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

export class AcpAgent extends Effect.Service<AcpAgent>()('oagent/AcpAgent', {
	effect: (config: {
		binary: string;
		args: readonly string[];
		clientInfoName: string;
		extensionHandlers?: Record<string, (params: unknown) => Promise<unknown>>;
	}) =>
		Effect.gen(function* () {
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

			const runTurn = (input: {
				prompt: string;
				model?: string;
				sessionId?: string;
				cwd: string;
				onEvent?: (event: SessionUpdate) => void;
				onExtensionEvent?: (method: string, params: unknown) => void;
			}) =>
				Effect.gen(function* () {
					const sessionResult = yield* (() => {
						if (input.sessionId !== undefined) {
							const sid = input.sessionId;
							return Effect.tryPromise({
								try: () =>
									conn.loadSession({
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
							try: () => conn.newSession({ cwd: input.cwd, mcpServers: [] }),
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

					const unregister = registerListener(
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
						extNotificationHandlers.set(
							sessionResult.sessionId,
							input.onExtensionEvent,
						);
					}

					const cleanup = Effect.sync(() => {
						unregister();
						extNotificationHandlers.delete(sessionResult.sessionId);
					});

					const response = yield* Effect.gen(function* () {
						const model = input.model;
						if (model !== undefined) {
							yield* Effect.tryPromise({
								try: () =>
									conn.setSessionConfigOption({
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
									void conn.cancel({
										sessionId: sessionResult.sessionId,
									});
								};
								signal.addEventListener('abort', onAbort, {
									once: true,
								});
								return conn
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

			const listModels = (): Effect.Effect<
				ReadonlyArray<{ id: string }>,
				AcpSessionError,
				never
			> =>
				Effect.tryPromise({
					try: () => conn.newSession({ cwd: process.cwd(), mcpServers: [] }),
					catch: (cause) => new AcpSessionError({ cause }),
				}).pipe(
					Effect.map((res) =>
						res.models === undefined || res.models === null
							? []
							: res.models.availableModels.map((m) => ({ id: m.modelId })),
					),
				);

			return { runTurn, listModels };
		}),
}) {}
