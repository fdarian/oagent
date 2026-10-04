import { Effect, Schema } from 'effect';

class ChannelTransportError extends Schema.TaggedError<ChannelTransportError>()(
	'ChannelTransportError',
	{
		cause: Schema.Defect(),
	},
) {}

class ChannelEventError extends Schema.TaggedError<ChannelEventError>()(
	'ChannelEventError',
	{ cause: Schema.Defect() },
) {}

export function listenForTerminal(
	engineUrl: string,
	jobId: string,
	onEvent: (event: unknown) => Promise<void>,
	options: {
		initialDelayMs?: number;
		maxDelayMs?: number;
		retryBudgetMs?: number;
	} = {},
) {
	return Effect.gen(function* () {
		const initialDelay = options.initialDelayMs ?? 500;
		const maxDelay = options.maxDelayMs ?? 5_000;
		const budget = options.retryBudgetMs ?? 120_000;
		const state = {
			delay: initialDelay,
			retrySince: undefined as number | undefined,
		};
		const connection = () =>
			Effect.scoped(
				Effect.gen(function* () {
					const response = yield* Effect.tryPromise({
						try: (signal) =>
							fetch(new URL(`/jobs/${jobId}/events`, engineUrl), { signal }),
						catch: (cause) => new ChannelTransportError({ cause }),
					});
					if (!response.ok || response.body === null) {
						return yield* new ChannelTransportError({
							cause: new Error(
								`Job event stream returned HTTP ${response.status} or no body`,
							),
						});
					}
					state.delay = initialDelay;
					const reader = yield* Effect.acquireRelease(
						Effect.succeed(response.body.getReader()),
						(reader) =>
							Effect.tryPromise({
								try: () => reader.cancel(),
								catch: (cause) => cause,
							}).pipe(
								Effect.catch((cause) =>
									Effect.logDebug('SSE reader cleanup failed', cause),
								),
							),
					);
					const decoder = new TextDecoder();
					const stream = { buffer: '' };
					for (;;) {
						const chunk = yield* Effect.tryPromise({
							try: () => reader.read(),
							catch: (cause) => new ChannelTransportError({ cause }),
						});
						if (chunk.done) return false;
						state.retrySince = undefined;
						stream.buffer += decoder.decode(chunk.value, { stream: true });
						const frames = stream.buffer.split('\n\n');
						const tail = frames.pop();
						if (tail === undefined)
							return yield* Effect.die(new Error('Missing SSE buffer tail'));
						stream.buffer = tail;
						for (const frame of frames) {
							const line = frame
								.split('\n')
								.find((line) => line.startsWith('data:'));
							if (line === undefined) continue;
							const payload = line.slice('data:'.length).trim();
							if (payload === '"__terminal__"') return true;
							const event = yield* Schema.decodeUnknownEffect(
								Schema.fromJsonString(Schema.Unknown),
							)(payload);
							yield* Effect.tryPromise({
								try: () => onEvent(event),
								catch: (cause) => new ChannelEventError({ cause }),
							});
						}
					}
				}),
			);
		for (;;) {
			const result = yield* connection().pipe(
				Effect.catchTag('ChannelTransportError', (error) =>
					Effect.succeed(error),
				),
			);
			if (result === true) return;
			const now = Date.now();
			if (state.retrySince === undefined) state.retrySince = now;
			const remaining = budget - (now - state.retrySince);
			if (remaining <= 0) {
				return yield* Effect.fail(
					result instanceof ChannelTransportError
						? result.cause
						: new Error(
								'Job event stream ended repeatedly without terminal sentinel',
							),
				);
			}
			yield* Effect.sleep(Math.min(state.delay, remaining));
			state.delay = Math.min(state.delay * 2, maxDelay);
		}
	});
}
