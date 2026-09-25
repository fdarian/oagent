import { Deferred, Effect, Schema, Stream } from 'effect';
import { HttpClientResponse } from 'effect/unstable/http';
import type { AcpAgent } from './acp-agent.ts';
import { AcpTurnFailed } from './acp-agent.ts';
import { createOpenCodeEventTranslator } from './opencode-api-events.ts';
import type { OpenCodeServiceClient } from './opencode-service-client.ts';

const WireEvent = Schema.fromJsonString(
	Schema.Struct({
		type: Schema.String,
		data: Schema.Record(Schema.String, Schema.Unknown),
	}),
);

type Input = Parameters<AcpAgent['Service']['runTurn']>[0];

function failed(code: string, cause: unknown): AcpTurnFailed {
	return new AcpTurnFailed({
		code,
		message: cause instanceof Error ? cause.message : String(cause),
		cause,
	});
}

function modelRef(model: string) {
	const id = model.startsWith('opencode:')
		? model.slice('opencode:'.length)
		: model;
	const separator = id.indexOf('/');
	if (separator < 1 || separator === id.length - 1) return undefined;
	return { providerID: id.slice(0, separator), id: id.slice(separator + 1) };
}

export function runOpenCodeApiTurn(
	service: OpenCodeServiceClient['Service'],
	binary: string,
	input: Input,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const session = yield* service
				.apiSession(binary, input.sessionId, input.cwd)
				.pipe(Effect.mapError((cause) => failed('SESSION_LOAD', cause)));
			const sessionId = session.id;
			if (input.onSessionId !== undefined)
				yield* Effect.sync(() => input.onSessionId?.(sessionId));
			if (input.model !== undefined || input.reasoningEffort !== undefined) {
				const requestedModel =
					input.model === undefined && session.model !== undefined
						? `${session.model.providerID}/${session.model.id}`
						: input.model;
				const model =
					requestedModel === undefined ? undefined : modelRef(requestedModel);
				if (model === undefined)
					return yield* failed(
						'SET_CONFIG_OPTION',
						new Error(`Invalid OpenCode model: ${String(requestedModel)}`),
					);
				const selected =
					input.reasoningEffort === undefined
						? model
						: { ...model, variant: input.reasoningEffort };
				if (
					session.model?.id !== selected.id ||
					session.model.providerID !== selected.providerID ||
					(input.reasoningEffort !== undefined &&
						session.model.variant !== input.reasoningEffort)
				) {
					yield* service
						.request(
							binary,
							'POST',
							`/api/session/${encodeURIComponent(sessionId)}/model`,
							{ model: selected },
						)
						.pipe(
							Effect.mapError((cause) => failed('SET_CONFIG_OPTION', cause)),
						);
				}
			}
			if (input.mode !== undefined && session.agent !== input.mode) {
				yield* service
					.request(
						binary,
						'POST',
						`/api/session/${encodeURIComponent(sessionId)}/agent`,
						{ agent: input.mode },
					)
					.pipe(Effect.mapError((cause) => failed('SET_CONFIG_OPTION', cause)));
			}
			yield* service
				.disableQuestion(binary, sessionId)
				.pipe(Effect.mapError((cause) => failed('SESSION_PERMISSION', cause)));

			const ready = yield* Deferred.make<void, AcpTurnFailed>();
			const terminal = yield* Deferred.make<
				'end_turn' | 'cancelled',
				AcpTurnFailed
			>();
			const translate = createOpenCodeEventTranslator();
			const state = { text: '', afterTool: false };
			const events = yield* service
				.request(binary, 'GET', '/api/event')
				.pipe(Effect.mapError((cause) => failed('EVENT_STREAM', cause)));
			const consume = HttpClientResponse.stream(Effect.succeed(events))
				.pipe(
					Stream.decodeText,
					Stream.splitLines,
					Stream.runForEach((line) =>
						Effect.gen(function* () {
							if (!line.startsWith('data: ')) return;
							const event = yield* Schema.decodeUnknownEffect(WireEvent)(
								line.slice(6),
							).pipe(Effect.mapError((cause) => failed('EVENT_STREAM', cause)));
							if (event.type === 'server.connected') {
								yield* Deferred.succeed(ready, undefined);
								return;
							}
							if (event.data.sessionID !== sessionId) return;
							if (
								event.type === 'permission.asked' &&
								typeof event.data.id === 'string'
							) {
								yield* service
									.request(
										binary,
										'POST',
										`/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(event.data.id)}/reply`,
										{ decision: 'always' },
									)
									.pipe(
										Effect.mapError((cause) =>
											failed('SESSION_PERMISSION', cause),
										),
									);
								return;
							}
							for (const update of translate(event)) {
								if (update.sessionUpdate === 'tool_call')
									state.afterTool = true;
								if (
									update.sessionUpdate === 'agent_message_chunk' &&
									update.content.type === 'text'
								) {
									if (state.afterTool) {
										state.text = '';
										state.afterTool = false;
									}
									state.text += update.content.text;
								}
								input.onEvent?.(update);
							}
							if (
								event.type === 'session.execution.succeeded' ||
								event.type === 'session.idle'
							)
								yield* Deferred.succeed(terminal, 'end_turn');
							if (event.type === 'session.execution.interrupted')
								yield* Deferred.succeed(terminal, 'cancelled');
							if (event.type === 'session.execution.failed')
								return yield* failed(
									'PROMPT',
									new Error(
										`OpenCode execution failed: ${JSON.stringify(event.data.error)}`,
									),
								);
						}),
					),
				)
				.pipe(
					Effect.flatMap(() =>
						failed(
							'EVENT_STREAM',
							new Error(
								'OpenCode event stream closed before the turn completed',
							),
						),
					),
					Effect.catch((cause) =>
						Effect.gen(function* () {
							const error =
								cause instanceof AcpTurnFailed
									? cause
									: failed('EVENT_STREAM', cause);
							yield* Deferred.fail(terminal, error);
							yield* Deferred.fail(ready, error);
						}),
					),
				);
			yield* Effect.forkScoped(consume);
			yield* Deferred.await(ready);
			const turn = Effect.gen(function* () {
				input.onPromptDispatch?.();
				yield* service
					.request(
						binary,
						'POST',
						`/api/session/${encodeURIComponent(sessionId)}/prompt`,
						{ text: input.prompt },
					)
					.pipe(Effect.mapError((cause) => failed('PROMPT', cause)));
				const stopReason = yield* Deferred.await(terminal);
				return { sessionId, text: state.text, stopReason };
			});
			return yield* turn.pipe(
				Effect.onInterrupt(() =>
					service
						.request(
							binary,
							'POST',
							`/api/session/${encodeURIComponent(sessionId)}/interrupt`,
						)
						.pipe(
							Effect.catch((cause) =>
								Effect.logWarning(
									`OpenCode interrupt failed: ${cause.message}`,
								),
							),
							Effect.asVoid,
						),
				),
			);
		}),
	);
}
