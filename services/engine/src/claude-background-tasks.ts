import type { SessionUpdate } from '@agentclientprotocol/sdk';
import {
	Deferred,
	Duration,
	Effect,
	Option,
	Schema,
	Stream,
	SubscriptionRef,
} from 'effect';

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

const BackgroundTasksChanged = Schema.Struct({
	subtype: Schema.Literal('background_tasks_changed'),
	tasks: Schema.Array(Schema.Struct({ task_id: Schema.String })),
});

const SessionStateChanged = Schema.Struct({
	subtype: Schema.Literal('session_state_changed'),
	state: Schema.Literals(['idle', 'running', 'requires_action']),
});

const SdkMessageNotification = Schema.Struct({
	message: Schema.Union([BackgroundTasksChanged, SessionStateChanged]),
});

const decodeSdkMessage = Schema.decodeUnknownOption(SdkMessageNotification);

/**
 * The adapter reports a backgrounded Bash call's task id only in the
 * PostToolUse `tool_response` it forwards for non-AIR clients. The same id
 * appears in `background_tasks_changed`; Monitor and other tools never carry
 * `backgroundTaskId`, so they are not mistaken for shells.
 */
const BackgroundShellLaunch = Schema.Struct({
	sessionUpdate: Schema.Literal('tool_call_update'),
	_meta: Schema.Struct({
		claudeCode: Schema.Struct({
			toolName: Schema.Literal('Bash'),
			toolResponse: Schema.Struct({ backgroundTaskId: Schema.String }),
		}),
	}),
});

const decodeShellLaunch = Schema.decodeUnknownOption(BackgroundShellLaunch);

type SessionState = 'idle' | 'running' | 'requires_action';

type TrackerState = {
	liveTaskIds: ReadonlySet<string>;
	/** Every shell launched on this session, which outlives the turn that launched it. */
	shellIds: ReadonlySet<string>;
	/** The shells launched since the current turn began; only these hold the turn. */
	turnShellIds: ReadonlySet<string>;
	sessionState: SessionState;
};

const initialState: TrackerState = {
	liveTaskIds: new Set(),
	shellIds: new Set(),
	turnShellIds: new Set(),
	sessionState: 'idle',
};

const anyLive = (ids: ReadonlySet<string>, state: TrackerState): boolean =>
	[...ids].some((id) => state.liveTaskIds.has(id));

const hasPendingTurnShell = (state: TrackerState): boolean =>
	anyLive(state.turnShellIds, state);

const hasLiveShell = (state: TrackerState): boolean =>
	anyLive(state.shellIds, state);

const untilProcessExits = (
	processExited: Promise<number> | undefined,
): Effect.Effect<void> =>
	processExited === undefined
		? Effect.never
		: Effect.promise(() => processExited).pipe(Effect.asVoid);

export type SettleOptions = {
	/** How long to wait for a follow-up cycle to start once the turn's shells ended. */
	followUpStartMs: number;
	/** How long the SDK must stay idle after a follow-up cycle before the hold ends. */
	settleMs: number;
};

export type BackgroundTaskTracker = {
	/** Starts a turn: only shells launched from now on hold it. */
	beginTurn: () => void;
	/**
	 * Extension notifications can be delivered after the prompt response that
	 * followed them, so the check waits briefly for them to land.
	 */
	hasLiveTurnShellsAfterFlush: Effect.Effect<boolean>;
	/**
	 * Completes once the turn's shells ended and their follow-up cycle (SDK
	 * `running`, then `idle`) finished. A cycle that never starts ends the wait
	 * after `followUpStartMs`.
	 */
	untilSettled: (options: SettleOptions) => Effect.Effect<void>;
	hasLiveShells: () => boolean;
	untilNoLiveShells: Effect.Effect<void>;
	/** Whether the SDK is mid-cycle, so the session's text is still being written. */
	isCycleRunning: () => boolean;
	untilCycleNotRunning: Effect.Effect<void>;
	/** Feeds `_claude/sdkMessage` notifications. */
	observeSdkMessage: (params: unknown) => void;
	observeShellLaunch: (taskId: string) => void;
};

const makeTracker: Effect.Effect<BackgroundTaskTracker> = Effect.gen(
	function* () {
		const state = yield* SubscriptionRef.make(initialState);
		const update = (change: (current: TrackerState) => TrackerState): void => {
			Effect.runSync(SubscriptionRef.update(state, change));
		};
		const current = () => SubscriptionRef.getUnsafe(state);
		const awaitState = (
			predicate: (value: TrackerState) => boolean,
		): Effect.Effect<void> =>
			SubscriptionRef.changes(state).pipe(
				Stream.filter(predicate),
				Stream.take(1),
				Stream.runDrain,
			);
		const followUpActivity = (value: TrackerState) =>
			value.sessionState !== 'idle' || hasPendingTurnShell(value);
		return {
			beginTurn: () => {
				update((value) => ({ ...value, turnShellIds: new Set() }));
			},
			hasLiveTurnShellsAfterFlush: Effect.sleep(
				Duration.millis(NOTIFICATION_FLUSH_MS),
			).pipe(Effect.map(() => hasPendingTurnShell(current()))),
			untilSettled: (options) =>
				Effect.gen(function* () {
					let followUpSeen = false;
					for (;;) {
						if (hasPendingTurnShell(current())) followUpSeen = false;
						yield* awaitState((value) => !hasPendingTurnShell(value));
						if (current().sessionState === 'idle') {
							const window = followUpSeen
								? options.settleMs
								: options.followUpStartMs;
							const activity = yield* awaitState(followUpActivity).pipe(
								Effect.timeoutOption(Duration.millis(window)),
							);
							if (Option.isNone(activity)) return;
							continue;
						}
						followUpSeen = true;
						yield* awaitState((value) => value.sessionState === 'idle');
					}
				}),
			hasLiveShells: () => hasLiveShell(current()),
			untilNoLiveShells: awaitState((value) => !hasLiveShell(value)),
			isCycleRunning: () => current().sessionState === 'running',
			untilCycleNotRunning: awaitState(
				(value) => value.sessionState !== 'running',
			),
			observeSdkMessage: (params) => {
				const decoded = decodeSdkMessage(params);
				if (Option.isNone(decoded)) return;
				const message = decoded.value.message;
				if (message.subtype === 'session_state_changed') {
					update((value) => ({ ...value, sessionState: message.state }));
					return;
				}
				update((value) => ({
					...value,
					liveTaskIds: new Set(message.tasks.map((task) => task.task_id)),
				}));
			},
			observeShellLaunch: (taskId) => {
				update((value) => ({
					...value,
					shellIds: new Set(value.shellIds).add(taskId),
					turnShellIds: new Set(value.turnShellIds).add(taskId),
				}));
			},
		};
	},
);

export type BackgroundTaskRegistry = {
	/** Routes a connection-level notification to the tracker of its ACP session. */
	observe: (sessionId: string, method: string, params: unknown) => void;
	/** Records the background shell a root-session tool call update launched, if any. */
	observeUpdate: (sessionId: string, update: SessionUpdate) => void;
	forSession: (sessionId: string) => BackgroundTaskTracker;
	/** Whether any session of the connection has a background shell still running. */
	hasLiveShells: () => boolean;
	untilNoLiveShells: Effect.Effect<void>;
};

/**
 * Background task state is per adapter process and outlives any one turn, so
 * it lives with the connection: a shell left running by one turn must keep the
 * process alive after that turn ended.
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
	const hasLiveShells = () =>
		[...trackers.values()].some((tracker) => tracker.hasLiveShells());
	return {
		observe: (sessionId, method, params) => {
			if (method !== SDK_MESSAGE_METHOD) return;
			forSession(sessionId).observeSdkMessage(params);
		},
		observeUpdate: (sessionId, update) => {
			const launch = decodeShellLaunch(update);
			if (Option.isNone(launch)) return;
			forSession(sessionId).observeShellLaunch(
				launch.value._meta.claudeCode.toolResponse.backgroundTaskId,
			);
		},
		forSession,
		hasLiveShells,
		untilNoLiveShells: Effect.suspend(
			function waitForTrackers(): Effect.Effect<void> {
				const live = [...trackers.values()].find((tracker) =>
					tracker.hasLiveShells(),
				);
				if (live === undefined) return Effect.void;
				return live.untilNoLiveShells.pipe(Effect.andThen(waitForTrackers));
			},
		),
	};
}

export type BackgroundHold = {
	/**
	 * Marks the turn holdable. Called synchronously when the prompt returns
	 * `end_turn`, so a release arriving before the shell check still lands.
	 */
	markHoldable: (tracker: BackgroundTaskTracker) => void;
	/** Whether the prompt has returned and the turn can only be released, not steered. */
	holdable: () => boolean;
	/**
	 * Keeps the turn open until the turn's shells and their follow-up cycle are
	 * done, the cap passes, the hold is released, or the process exits.
	 */
	hold: (input: {
		settle: SettleOptions;
		maxHoldMs: number;
		processExited?: Promise<number>;
		cancel: Effect.Effect<void>;
	}) => Effect.Effect<void>;
	/**
	 * Ends the hold, first waiting out a follow-up cycle that is mid-run so its
	 * text is complete. False when the turn is not holdable. Bounded by the cap
	 * because the turn itself ends then.
	 */
	release: Effect.Effect<boolean>;
	/** Marks the turn finished, which also ends any release still waiting. */
	close: () => void;
};

export const makeBackgroundHold: Effect.Effect<BackgroundHold> = Effect.gen(
	function* () {
		const released = yield* Deferred.make<void>();
		const closed = yield* Deferred.make<void>();
		const state = {
			tracker: undefined as BackgroundTaskTracker | undefined,
			closed: false,
		};
		return {
			markHoldable: (tracker) => {
				state.tracker = tracker;
			},
			holdable: () => state.tracker !== undefined && !state.closed,
			hold: (input) =>
				Effect.suspend(() => {
					if (state.tracker === undefined) {
						return Effect.die(new Error('Hold started before it was holdable'));
					}
					return Effect.raceFirst(
						Effect.raceFirst(
							Effect.raceFirst(
								state.tracker.untilSettled(input.settle),
								Deferred.await(released),
							),
							Effect.sleep(Duration.millis(input.maxHoldMs)),
						),
						untilProcessExits(input.processExited),
					);
				}).pipe(Effect.onInterrupt(() => input.cancel)),
			release: Effect.suspend(() => {
				const tracker = state.tracker;
				if (tracker === undefined || state.closed) return Effect.succeed(false);
				return tracker.untilCycleNotRunning.pipe(
					Effect.raceFirst(Deferred.await(closed)),
					Effect.andThen(Deferred.succeed(released, undefined)),
					Effect.as(true),
				);
			}),
			close: () => {
				state.closed = true;
				Effect.runSync(Deferred.succeed(closed, undefined));
			},
		};
	},
);
