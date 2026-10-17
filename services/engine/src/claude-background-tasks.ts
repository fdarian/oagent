import {
	Deferred,
	Duration,
	Effect,
	Option,
	Schema,
	Stream,
	SubscriptionRef,
} from 'effect';
import { AcpTurnFailed } from './acp-turn-recovery.ts';

const NOTIFICATION_FLUSH_MS = 50;
const SDK_MESSAGE_METHOD = '_claude/sdkMessage';

/**
 * Session `_meta.claudeCode.emitRawSDKMessages` filter. The adapter forwards
 * only these SDK messages, so every other stream event costs nothing.
 */
export const claudeRawMessageFilter = [
	{ type: 'system', subtype: 'background_tasks_changed' },
	{ type: 'system', subtype: 'session_state_changed' },
];

/**
 * Subagents already hold the ACP prompt open, and a Monitor is persistent by
 * design, so only tasks that finish on their own count as work to wait for.
 */
const HELD_TASK_TYPES: ReadonlySet<string> = new Set([
	'local_bash',
	'local_workflow',
]);

const BackgroundTasksChanged = Schema.Struct({
	subtype: Schema.Literal('background_tasks_changed'),
	tasks: Schema.Array(
		Schema.Struct({
			task_type: Schema.optional(Schema.String),
			ambient: Schema.optional(Schema.Boolean),
		}),
	),
});

const SessionStateChanged = Schema.Struct({
	subtype: Schema.Literal('session_state_changed'),
	state: Schema.Literals(['idle', 'running', 'requires_action']),
});

const SdkMessageNotification = Schema.Struct({
	message: Schema.Union([BackgroundTasksChanged, SessionStateChanged]),
});

const decodeSdkMessage = Schema.decodeUnknownOption(SdkMessageNotification);

type TrackerState = {
	liveTasks: number;
	sessionState: 'idle' | 'running' | 'requires_action';
};

const initialState: TrackerState = { liveTasks: 0, sessionState: 'idle' };

const isSettled = (state: TrackerState): boolean =>
	state.liveTasks === 0 && state.sessionState === 'idle';

const failWhenProcessExits = (
	processExited: Promise<number> | undefined,
): Effect.Effect<never, AcpTurnFailed> => {
	if (processExited === undefined) return Effect.never;
	return Effect.promise(() => processExited).pipe(
		Effect.flatMap((code) =>
			Effect.fail(
				new AcpTurnFailed({
					code: 'ACP_BACKGROUND_HOLD_INTERRUPTED',
					message: `The Claude process exited (code ${code}) while the turn was waiting for background tasks.`,
					cause: new Error('ACP process exited during background hold'),
				}),
			),
		),
	);
};

export type BackgroundTaskTracker = {
	/** Feeds `_claude/sdkMessage` notifications; every other method is ignored. */
	observe: (method: string, params: unknown) => void;
	/**
	 * Extension notifications can be delivered after the prompt response that
	 * followed them, so the check waits briefly for them to land.
	 */
	hasLiveTasksAfterFlush: Effect.Effect<boolean>;
	/**
	 * Completes once no background task is live and the SDK has been idle for
	 * `settleMs`: the gap between a task ending and its follow-up cycle starting
	 * must not end a hold.
	 */
	untilSettled: (settleMs: number) => Effect.Effect<void>;
};

const makeTracker: Effect.Effect<BackgroundTaskTracker> = Effect.gen(
	function* () {
		const state = yield* SubscriptionRef.make(initialState);
		const update = (change: (current: TrackerState) => TrackerState): void => {
			Effect.runSync(SubscriptionRef.update(state, change));
		};
		return {
			observe: (method, params) => {
				if (method !== SDK_MESSAGE_METHOD) return;
				const decoded = decodeSdkMessage(params);
				if (Option.isNone(decoded)) return;
				const message = decoded.value.message;
				if (message.subtype === 'session_state_changed') {
					update((current) => ({ ...current, sessionState: message.state }));
					return;
				}
				const liveTasks = message.tasks.filter(
					(task) =>
						task.ambient !== true &&
						task.task_type !== undefined &&
						HELD_TASK_TYPES.has(task.task_type),
				).length;
				update((current) => ({ ...current, liveTasks }));
			},
			hasLiveTasksAfterFlush: Effect.sleep(
				Duration.millis(NOTIFICATION_FLUSH_MS),
			).pipe(Effect.map(() => SubscriptionRef.getUnsafe(state).liveTasks > 0)),
			untilSettled: (settleMs) =>
				SubscriptionRef.changes(state).pipe(
					Stream.map(isSettled),
					Stream.changes,
					Stream.debounce(Duration.millis(settleMs)),
					Stream.filter((settled) => settled),
					Stream.take(1),
					Stream.runDrain,
				),
		};
	},
);

export type BackgroundTaskRegistry = {
	/** Routes a connection-level notification to the tracker of its ACP session. */
	observe: (sessionId: string, method: string, params: unknown) => void;
	forSession: (sessionId: string) => BackgroundTaskTracker;
};

/**
 * Background task state is per adapter process and outlives any one turn, so
 * it lives with the connection: a shell left running by one turn must still be
 * visible to the next turn on that session.
 */
export function createBackgroundTaskRegistry(): BackgroundTaskRegistry {
	const trackers = new Map<string, BackgroundTaskTracker>();
	const forSession = (sessionId: string): BackgroundTaskTracker => {
		const existing = trackers.get(sessionId);
		if (existing !== undefined) return existing;
		const created = Effect.runSync(makeTracker);
		trackers.set(sessionId, created);
		return created;
	};
	return {
		observe: (sessionId, method, params) => {
			forSession(sessionId).observe(method, params);
		},
		forSession,
	};
}

export type BackgroundHold = {
	/** Keeps the turn open until the tracker settles, the hold is released, or the process dies. */
	hold: (input: {
		tracker: BackgroundTaskTracker;
		settleMs: number;
		processExited?: Promise<number>;
		cancel: Effect.Effect<void>;
	}) => Effect.Effect<void, AcpTurnFailed>;
	/** Ends an in-progress hold; false when the turn is not being held. */
	release: () => boolean;
};

export const makeBackgroundHold: Effect.Effect<BackgroundHold> = Effect.gen(
	function* () {
		const released = yield* Deferred.make<void>();
		const holding = { active: false };
		return {
			hold: (input) =>
				Effect.sync(() => {
					holding.active = true;
				}).pipe(
					Effect.andThen(
						Effect.raceFirst(
							Effect.raceFirst(
								input.tracker.untilSettled(input.settleMs),
								Deferred.await(released),
							),
							failWhenProcessExits(input.processExited),
						),
					),
					Effect.onInterrupt(() => input.cancel),
					Effect.ensuring(
						Effect.sync(() => {
							holding.active = false;
						}),
					),
				),
			release: () => {
				if (!holding.active) return false;
				Effect.runSync(Deferred.succeed(released, undefined));
				return true;
			},
		};
	},
);
