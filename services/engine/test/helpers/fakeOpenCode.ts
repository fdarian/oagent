import type { SessionUpdate, StopReason } from '@agentclientprotocol/sdk';
import { Effect, Layer, Schema } from 'effect';
import type { AcpSessionError, AcpTurnFailed } from '../../src/acp-agent.ts';
import { OpenCode } from '../../src/opencode.ts';

export class FakeOpenCodeError extends Schema.TaggedError<FakeOpenCodeError>()(
	'FakeOpenCodeError',
	{ message: Schema.String },
) {}

export type FakeTurnResult = {
	readonly sessionId: string;
	readonly text: string;
	readonly stopReason: StopReason;
};

const defaultTurnResult = (): FakeTurnResult => ({
	sessionId: 'fake-session-id',
	text: 'fake turn complete',
	stopReason: 'end_turn',
});

export type FakeOpenCodeScript = {
	readonly events?: ReadonlyArray<SessionUpdate>;
	readonly result?: FakeTurnResult;
	readonly failWith?: unknown;
};

const asTurnFailure = (error: unknown): AcpSessionError | AcpTurnFailed =>
	error as AcpSessionError | AcpTurnFailed;

const openCodeImpl = (impl: {
	runTurn: OpenCode['runTurn'];
	listModels: OpenCode['listModels'];
}): OpenCode =>
	({
		_tag: 'oagent/OpenCode',
		...impl,
	}) as OpenCode;

/** Immediate scripted turn: emit `events`, then succeed or `failWith`. */
export const scriptedFakeOpenCodeLayer = (
	script: FakeOpenCodeScript,
): Layer.Layer<OpenCode> =>
	Layer.succeed(
		OpenCode,
		openCodeImpl({
			runTurn: (input) =>
				Effect.gen(function* () {
					if (script.failWith !== undefined) {
						return yield* Effect.fail(asTurnFailure(script.failWith));
					}
					for (const event of script.events ?? []) {
						input.onEvent?.(event);
					}
					return script.result ?? defaultTurnResult();
				}),
			listModels: () => Effect.succeed([]),
		}),
	);

/** Shorthand for `scriptedFakeOpenCodeLayer({ failWith })`. */
export const failingFakeOpenCodeLayer = (
	error: unknown = new FakeOpenCodeError({
		message: 'scripted opencode failure',
	}),
): Layer.Layer<OpenCode> => scriptedFakeOpenCodeLayer({ failWith: error });

/**
 * Blocks `runTurn` on a gate until `release` is called — for SSE buffer-then-drain tests.
 * Before the gate: emits `historyCount` chunk events. After `release`: emits `afterGateEvent`, then completes.
 */
export const gatedFakeOpenCodeLayer = (opts?: {
	readonly historyCount?: number;
	readonly afterGateEvent?: SessionUpdate;
	readonly result?: FakeTurnResult;
}): {
	readonly layer: Layer.Layer<OpenCode>;
	readonly release: Effect.Effect<void>;
} => {
	let resolveGate!: () => void;
	const gate = new Promise<void>((resolve) => {
		resolveGate = resolve;
	});
	const historyCount = opts?.historyCount ?? 120;
	const afterGateEvent: SessionUpdate = opts?.afterGateEvent ?? {
		sessionUpdate: 'agent_message_chunk',
		messageId: 'live-buffer-window',
		content: { type: 'text', text: 'buffered-during-replay' },
	};

	const layer = Layer.succeed(
		OpenCode,
		openCodeImpl({
			runTurn: (input) =>
				Effect.gen(function* () {
					for (let i = 0; i < historyCount; i++) {
						input.onEvent?.({
							sessionUpdate: 'agent_message_chunk',
							messageId: `hist-${i}`,
							content: { type: 'text', text: `history-${i}` },
						});
					}
					yield* Effect.promise(() => gate);
					input.onEvent?.(afterGateEvent);
					return opts?.result ?? defaultTurnResult();
				}),
			listModels: () => Effect.succeed([]),
		}),
	);

	const release = Effect.sync(() => {
		resolveGate();
	});

	return { layer, release };
};
