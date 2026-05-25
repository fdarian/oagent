/// <reference types="bun" />
import {
	type Client,
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
	type SessionUpdate,
} from '@agentclientprotocol/sdk';
import { Effect, Schema } from 'effect';

class OpenCodeSessionError extends Schema.TaggedError<OpenCodeSessionError>()(
	'OpenCodeSessionError',
	{ cause: Schema.Defect },
) {}

class OpenCodeTurnFailed extends Schema.TaggedError<OpenCodeTurnFailed>()(
	'OpenCodeTurnFailed',
	{
		code: Schema.optional(Schema.String),
		message: Schema.String,
		cause: Schema.Defect,
	},
) {}

export class OpenCode extends Effect.Service<OpenCode>()('oagent/OpenCode', {
	effect: Effect.gen(function* () {
		const subprocess = yield* Effect.acquireRelease(
			Effect.sync(() => {
				const transform = new TransformStream<Uint8Array, Uint8Array>();
				const proc = Bun.spawn(['opencode', 'acp'], {
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
							outcome: { outcome: 'selected', optionId: allowAlways.optionId },
						};
					}
					const allowOnce = params.options.find(
						(opt) => opt.kind === 'allow_once',
					);
					if (allowOnce !== undefined) {
						return {
							outcome: { outcome: 'selected', optionId: allowOnce.optionId },
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
					clientInfo: { name: 'oagent', version: '0.1.0' },
				}),
			catch: (cause) => new OpenCodeSessionError({ cause }),
		});

		const runTurn = (input: {
			prompt: string;
			model?: string;
			sessionId?: string;
			cwd: string;
			onEvent?: (event: SessionUpdate) => void;
		}) =>
			Effect.gen(function* () {
				const sessionId = yield* (() => {
					if (input.sessionId !== undefined) {
						const sid = input.sessionId;
						return Effect.tryPromise({
							try: () =>
								conn.loadSession({
									sessionId: sid,
									cwd: input.cwd,
									mcpServers: [],
								}),
							catch: (cause) => new OpenCodeSessionError({ cause }),
						}).pipe(Effect.map(() => sid));
					}
					return Effect.tryPromise({
						try: () =>
							conn
								.newSession({ cwd: input.cwd, mcpServers: [] })
								.then((res) => res.sessionId),
						catch: (cause) => new OpenCodeSessionError({ cause }),
					});
				})();

				let buffer = '';

				const unregister = registerListener(sessionId, (update) => {
					if (input.onEvent !== undefined) {
						input.onEvent(update);
					}
					if (
						update.sessionUpdate === 'agent_message_chunk' &&
						update.content.type === 'text'
					) {
						buffer += update.content.text;
					}
				});

				const response = yield* Effect.gen(function* () {
					const model = input.model;
					if (model !== undefined) {
						yield* Effect.tryPromise({
							try: () =>
								conn.setSessionConfigOption({
									sessionId,
									configId: 'model',
									value: model,
								}),
							catch: (cause) =>
								new OpenCodeTurnFailed({
									code: 'SET_CONFIG_OPTION',
									message: 'setConfigOption failed',
									cause,
								}),
						});
					}

					return yield* Effect.tryPromise({
						try: (signal) => {
							const onAbort = () => {
								void conn.cancel({ sessionId });
							};
							signal.addEventListener('abort', onAbort, { once: true });
							return conn
								.prompt({
									sessionId,
									prompt: [{ type: 'text', text: input.prompt }],
								})
								.finally(() => {
									signal.removeEventListener('abort', onAbort);
								});
						},
						catch: (cause) =>
							new OpenCodeTurnFailed({
								code: 'PROMPT_REJECTED',
								message: 'prompt rejected',
								cause,
							}),
					});
				}).pipe(Effect.ensuring(Effect.sync(unregister)));

				return {
					sessionId,
					text: buffer,
					stopReason: response.stopReason,
				};
			});

		return { runTurn };
	}),
}) {}
