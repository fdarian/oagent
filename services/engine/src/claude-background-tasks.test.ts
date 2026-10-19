import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import type {
	ClientSideConnection,
	SessionUpdate,
} from '@agentclientprotocol/sdk';
import { Effect, Fiber, Schedule } from 'effect';
import { makeAcpAgent, runAcpTurn } from './acp-agent.ts';
import { createBackgroundTaskRegistry } from './claude-background-tasks.ts';

const SESSION_ID = 'ses_claude';
const SETTLE_MS = 50;
const MAX_HOLD_MS = 5_000;

type PromptResult = Awaited<ReturnType<ClientSideConnection['prompt']>>;
type NewSessionResult = Awaited<ReturnType<ClientSideConnection['newSession']>>;

const sdkMessage = (message: Record<string, unknown>) => ({
	sessionId: SESSION_ID,
	message: { type: 'system', ...message },
});

const tasksChanged = (tasks: ReadonlyArray<Record<string, unknown>>) =>
	sdkMessage({ subtype: 'background_tasks_changed', tasks });

const sessionState = (state: string) =>
	sdkMessage({ subtype: 'session_state_changed', state });

const bashLaunch = (taskId: string): SessionUpdate => ({
	sessionUpdate: 'tool_call_update',
	toolCallId: `call-${taskId}`,
	_meta: {
		claudeCode: {
			toolName: 'Bash',
			toolResponse: { backgroundTaskId: taskId },
		},
	},
});

const shellTask = (taskId: string) => ({
	task_id: taskId,
	task_type: 'local_bash',
});

const FOLLOW_UP_START_MS = 500;

function createFakeClaude(
	prompt: (input: {
		update: (event: SessionUpdate) => void;
		raw: (params: unknown) => void;
	}) => Promise<void>,
	options: { processExited?: Promise<number> } = {},
) {
	const state = {
		listener: undefined as ((update: SessionUpdate) => void) | undefined,
		cancelled: 0,
		prompts: 0,
	};
	const extNotificationHandlers = new Map<
		string,
		(method: string, params: unknown) => void
	>();
	const backgroundTasks = createBackgroundTaskRegistry();
	const conn = {
		newSession: async (): Promise<NewSessionResult> =>
			({ sessionId: SESSION_ID }) as NewSessionResult,
		prompt: async (): Promise<PromptResult> => {
			state.prompts += 1;
			await prompt({
				update: (event) => {
					backgroundTasks.observeUpdate(SESSION_ID, event);
					state.listener?.(event);
				},
				raw: (params) =>
					backgroundTasks.observe(SESSION_ID, '_claude/sdkMessage', params),
			});
			return { stopReason: 'end_turn' } as PromptResult;
		},
		cancel: async () => {
			state.cancelled += 1;
		},
	} as unknown as ClientSideConnection;
	return {
		state,
		env: {
			conn,
			registerListener: (
				_sessionId: string,
				listener: (update: SessionUpdate) => void,
			) => {
				state.listener = listener;
				return () => {
					state.listener = undefined;
				};
			},
			extNotificationHandlers,
			backgroundTasks,
			processExited: options.processExited,
		},
	};
}

const text = (value: string): SessionUpdate => ({
	sessionUpdate: 'agent_message_chunk',
	content: { type: 'text', text: value },
});

/** Delays past the window in which the turn still waits for late notifications. */
const later = (ms: number, run: () => void) => {
	setTimeout(run, ms + 100);
};

const runClaudeTurn = (
	fake: ReturnType<typeof createFakeClaude>,
	options: {
		maxHoldMs?: number;
		followUpStartMs?: number;
		onTurnActive?: Parameters<typeof runAcpTurn>[1]['onTurnActive'];
	} = {},
) => {
	const events: Array<SessionUpdate> = [];
	return {
		events,
		run: runAcpTurn(fake.env, {
			prompt: 'go',
			cwd: '/tmp',
			onTurnActive: options.onTurnActive,
			backgroundTasks: {
				settleMs: SETTLE_MS,
				followUpStartMs: FOLLOW_UP_START_MS,
				maxHoldMs: options.maxHoldMs ?? MAX_HOLD_MS,
				...(options.followUpStartMs === undefined
					? {}
					: { followUpStartMs: options.followUpStartMs }),
			},
			onEvent: (event) => events.push(event),
		}),
	};
};

describe('Claude background task hold', () => {
	test('resolves immediately when no background task is live', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([]));
			input.update(text('all done'));
		});
		const turn = runClaudeTurn(fake);

		const result = await Effect.runPromise(turn.run);

		expect(result.text).toBe('all done');
		expect(result.stopReason).toBe('end_turn');
	});

	test('resolves immediately when the adapter emits no raw messages', async () => {
		const fake = createFakeClaude(async (input) => {
			input.update(text('all done'));
		});

		const result = await Effect.runPromise(runClaudeTurn(fake).run);

		expect(result.text).toBe('all done');
	});

	test('does not hold for live tasks the turn did not launch from a Bash call', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(
				tasksChanged([
					{ task_id: 'agent', task_type: 'local_agent' },
					// The CLI registers a Monitor as local_bash, but no Bash result names it.
					shellTask('monitor'),
					{ ...shellTask('ambient'), ambient: true },
				]),
			);
			input.update({
				sessionUpdate: 'tool_call_update',
				toolCallId: 'call-monitor',
				_meta: { claudeCode: { toolName: 'Monitor', toolResponse: {} } },
			});
			input.update(text('all done'));
		});

		const result = await Effect.runPromise(runClaudeTurn(fake).run);

		expect(result.text).toBe('all done');
	});

	test('does not hold for a shell an earlier turn launched', async () => {
		const fake = createFakeClaude(async (input) => {
			if (fake.state.prompts === 1) {
				input.raw(tasksChanged([shellTask('shell-1')]));
				input.update(bashLaunch('shell-1'));
				input.update(text('waiting on the shell'));
			} else {
				input.update(text('unrelated'));
			}
		});

		const first = await Effect.runPromise(
			runClaudeTurn(fake, { maxHoldMs: 50 }).run,
		);
		const second = await Effect.runPromise(runClaudeTurn(fake).run);

		expect(first.text).toBe('waiting on the shell');
		expect(second.text).toBe('unrelated');
	});

	test('holds until the shell ended and its follow-up cycle went idle, then reports the follow-up text', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shellTask('shell-1')]));
			input.update(bashLaunch('shell-1'));
			input.update(text('waiting on the shell'));
			later(20, () => input.raw(tasksChanged([])));
			later(20 + SETTLE_MS / 2, () => input.raw(sessionState('running')));
			later(20 + SETTLE_MS / 2 + 10, () =>
				input.update(text('shell finished')),
			);
			later(20 + SETTLE_MS / 2 + 30, () => input.raw(sessionState('idle')));
		});
		const turn = runClaudeTurn(fake);

		const result = await Effect.runPromise(turn.run);

		expect(result.text).toBe('shell finished');
		expect(result.stopReason).toBe('end_turn');
		expect(
			turn.events
				.filter((event) => event.sessionUpdate === 'agent_message_chunk')
				.map((event) => event.sessionUpdate),
		).toEqual(['agent_message_chunk', 'agent_message_chunk']);
	});

	test('waits out a follow-up cycle that began before the shell left the live set', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shellTask('shell-1')]));
			input.update(bashLaunch('shell-1'));
			input.update(text('waiting on the shell'));
			later(10, () => input.raw(sessionState('running')));
			later(20, () => input.raw(tasksChanged([])));
			later(30, () => input.update(text('shell finished')));
			later(40, () => input.raw(sessionState('idle')));
		});

		const result = await Effect.runPromise(runClaudeTurn(fake).run);

		expect(result.text).toBe('shell finished');
	});

	test('keeps holding while a follow-up cycle launches another shell', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shellTask('shell-1')]));
			input.update(bashLaunch('shell-1'));
			input.update(text('waiting on the shell'));
			later(10, () => input.raw(tasksChanged([])));
			later(20, () => input.raw(sessionState('running')));
			later(30, () => {
				input.raw(tasksChanged([shellTask('shell-2')]));
				input.update(bashLaunch('shell-2'));
			});
			later(40, () => input.raw(sessionState('idle')));
			later(40 + SETTLE_MS * 3, () => {
				input.raw(tasksChanged([]));
				input.raw(sessionState('running'));
				input.update(text('second shell finished'));
				input.raw(sessionState('idle'));
			});
		});

		const result = await Effect.runPromise(runClaudeTurn(fake).run);

		expect(result.text).toBe('second shell finished');
	});

	test('finishes with the pre-hold text when no follow-up cycle starts', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shellTask('shell-1')]));
			input.update(bashLaunch('shell-1'));
			input.update(text('waiting on the shell'));
			later(10, () => input.raw(tasksChanged([])));
		});
		const startedAt = Date.now();

		const result = await Effect.runPromise(
			runClaudeTurn(fake, { followUpStartMs: 200 }).run,
		);

		expect(result.text).toBe('waiting on the shell');
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
	});

	test('releases the hold at the cap while the shell is still running', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shellTask('shell-1')]));
			input.update(bashLaunch('shell-1'));
			input.update(text('waiting on the shell'));
		});
		const startedAt = Date.now();

		const result = await Effect.runPromise(
			runClaudeTurn(fake, { maxHoldMs: 200 }).run,
		);

		expect(result.text).toBe('waiting on the shell');
		expect(result.stopReason).toBe('end_turn');
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
		expect(fake.state.cancelled).toBe(0);
	});

	test('keeps the pre-hold text when the cap cuts a follow-up cycle short', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shellTask('shell-1')]));
			input.update(bashLaunch('shell-1'));
			input.update(text('waiting on the shell'));
			later(10, () => input.raw(tasksChanged([])));
			later(20, () => input.raw(sessionState('running')));
			later(30, () => input.update(text('half of the follow-up')));
		});

		const result = await Effect.runPromise(
			runClaudeTurn(fake, { maxHoldMs: 400 }).run,
		);

		expect(result.text).toBe('waiting on the shell');
	});

	test('finishes with the pre-hold text when the process exits during the hold', async () => {
		const exited = Promise.withResolvers<number>();
		const fake = createFakeClaude(
			async (input) => {
				input.raw(tasksChanged([shellTask('shell-1')]));
				input.update(bashLaunch('shell-1'));
				input.update(text('waiting on the shell'));
				later(0, () => exited.resolve(1));
			},
			{ processExited: exited.promise },
		);

		const result = await Effect.runPromise(runClaudeTurn(fake).run);

		expect(result.text).toBe('waiting on the shell');
		expect(result.stopReason).toBe('end_turn');
	});

	test('a release ends the hold with the pre-hold text', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shellTask('shell-1')]));
			input.update(bashLaunch('shell-1'));
			input.update(text('waiting on the shell'));
		});
		const active = Promise.withResolvers<{
			release: Effect.Effect<boolean>;
			holdable: () => boolean;
		}>();
		const turn = runClaudeTurn(fake, {
			onTurnActive: (_sessionId, _connection, hold) => {
				active.resolve(hold);
				return () => {};
			},
		});

		const released = await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* turn.run.pipe(Effect.forkChild);
				const hold = yield* Effect.promise(() => active.promise);
				yield* Effect.sleep(SETTLE_MS * 2);
				const holdableWhileHeld = hold.holdable();
				const releasedHold = yield* hold.release;
				const result = yield* Fiber.join(fiber);
				return { holdableWhileHeld, releasedHold, result };
			}),
		);

		expect(released.holdableWhileHeld).toBe(true);
		expect(released.releasedHold).toBe(true);
		expect(released.result.text).toBe('waiting on the shell');
	});

	test('a release during a follow-up cycle waits for it and keeps its answer', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shellTask('shell-1')]));
			input.update(bashLaunch('shell-1'));
			input.update(text('waiting on the shell'));
			later(10, () => input.raw(tasksChanged([])));
			later(20, () => input.raw(sessionState('running')));
			later(30, () => input.update(text('shell finished')));
			later(300, () => input.raw(sessionState('idle')));
		});
		const active = Promise.withResolvers<{ release: Effect.Effect<boolean> }>();
		const turn = runClaudeTurn(fake, {
			onTurnActive: (_sessionId, _connection, hold) => {
				active.resolve(hold);
				return () => {};
			},
		});

		const outcome = await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* turn.run.pipe(Effect.forkChild);
				const hold = yield* Effect.promise(() => active.promise);
				// Past the start of the follow-up cycle, before it goes idle.
				yield* Effect.sleep(250);
				const startedAt = Date.now();
				const releasedHold = yield* hold.release;
				const waitedMs = Date.now() - startedAt;
				const result = yield* Fiber.join(fiber);
				return { releasedHold, waitedMs, result };
			}),
		);

		expect(outcome.releasedHold).toBe(true);
		expect(outcome.waitedMs).toBeGreaterThanOrEqual(100);
		expect(outcome.result.text).toBe('shell finished');
	});

	test('cancels the session when the held turn is interrupted', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shellTask('shell-1')]));
			input.update(bashLaunch('shell-1'));
			input.update(text('waiting on the shell'));
		});
		const turn = runClaudeTurn(fake);

		await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* turn.run.pipe(Effect.forkChild);
				yield* Effect.sleep(SETTLE_MS * 2);
				yield* Fiber.interrupt(fiber);
			}),
		);

		expect(fake.state.cancelled).toBe(1);
	});
});

describe('Claude background task registry', () => {
	test('tracks a launched shell until it leaves the live set', async () => {
		const registry = createBackgroundTaskRegistry();
		registry.observeUpdate(SESSION_ID, bashLaunch('shell-1'));
		registry.observe(
			SESSION_ID,
			'_claude/sdkMessage',
			tasksChanged([shellTask('shell-1')]),
		);
		expect(registry.hasLiveShells()).toBe(true);

		const ended = Effect.runPromise(registry.untilNoLiveShells);
		registry.observe(SESSION_ID, '_claude/sdkMessage', tasksChanged([]));

		await ended;
		expect(registry.hasLiveShells()).toBe(false);
	});

	test('ignores live tasks no Bash call launched and other notification methods', () => {
		const registry = createBackgroundTaskRegistry();
		registry.observe(
			SESSION_ID,
			'_claude/sdkMessage',
			tasksChanged([shellTask('monitor')]),
		);
		registry.observe(
			SESSION_ID,
			'_other/notification',
			tasksChanged([shellTask('x')]),
		);

		expect(registry.hasLiveShells()).toBe(false);
	});
});

describe('Claude background task hold through the ACP agent', () => {
	const agentScript = fileURLToPath(
		new URL('./test-acp-agent.ts', import.meta.url),
	);
	const makeAgent = (idleTimeToLive?: number) =>
		makeAcpAgent({
			binary: process.execPath,
			args: [agentScript],
			clientInfoName: 'oagent-test',
			...(idleTimeToLive === undefined ? {} : { idleTimeToLive }),
		});
	const holdOptions = {
		settleMs: SETTLE_MS,
		followUpStartMs: FOLLOW_UP_START_MS,
		maxHoldMs: MAX_HOLD_MS,
	};

	test('records the autonomous follow-up cycle into the same turn', async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* makeAgent();
					const events: Array<SessionUpdate> = [];
					const completed = yield* agent.runTurn({
						prompt: 'background-shell:finish',
						cwd: process.cwd(),
						backgroundTasks: holdOptions,
						onEvent: (event) => events.push(event),
					});
					return { completed, events };
				}),
			),
		);

		expect(result.completed.text).toBe('shell finished');
		expect(result.completed.stopReason).toBe('end_turn');
		expect(
			result.events.flatMap((event) =>
				event.sessionUpdate === 'agent_message_chunk' &&
				event.content.type === 'text'
					? [event.content.text]
					: [],
			),
		).toEqual(['waiting on the shell', 'shell finished']);
	});

	test('does not hold a later turn for the shell an earlier turn left running', async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* makeAgent();
					const sessionId = Promise.withResolvers<string>();
					const first = yield* agent
						.runTurn({
							prompt: 'background-shell',
							cwd: process.cwd(),
							backgroundTasks: { ...holdOptions, maxHoldMs: 200 },
							onSessionId: sessionId.resolve,
						})
						.pipe(Effect.forkChild);
					const id = yield* Effect.promise(() => sessionId.promise);
					const firstResult = yield* Fiber.join(first);
					const second = yield* agent.runTurn({
						prompt: 'finish-shell',
						sessionId: id,
						cwd: process.cwd(),
						backgroundTasks: holdOptions,
					});
					return { firstResult, second };
				}),
			),
		);

		expect(result.firstResult.text).toBe('waiting on the shell');
		expect(result.second.text).toBe('ok');
	});

	test('keeps the adapter process alive while a shell outlives the capped hold', async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* makeAgent(100);
					const before = yield* agent.runTurn({
						prompt: 'pid',
						cwd: process.cwd(),
					});
					const held = yield* agent.runTurn({
						prompt: 'background-shell',
						cwd: process.cwd(),
						backgroundTasks: { ...holdOptions, maxHoldMs: 400 },
					});
					// Past several idle lifetimes, inside the keep-alive cap.
					yield* Effect.sleep(250);
					const after = yield* agent.runTurn({
						prompt: 'pid',
						cwd: process.cwd(),
					});
					return { before, held, after };
				}),
			),
		);

		expect(result.held.text).toBe('waiting on the shell');
		expect(result.after.text).toBe(result.before.text);
	});

	test('releases the process to its idle lifetime once the keep-alive cap passes', async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* makeAgent(100);
					const before = yield* agent.runTurn({
						prompt: 'pid',
						cwd: process.cwd(),
					});
					yield* agent.runTurn({
						prompt: 'background-shell',
						cwd: process.cwd(),
						backgroundTasks: { ...holdOptions, maxHoldMs: 100 },
					});
					// The cap counts from the turn's end, then the idle lifetime runs.
					yield* Effect.sleep(600);
					const after = yield* agent.runTurn({
						prompt: 'pid',
						cwd: process.cwd(),
					});
					return { before, after };
				}),
			),
		);

		expect(result.after.text).not.toBe(result.before.text);
	});

	test('does not end a held turn when a message is steered at it', async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* makeAgent();
					const sessionId = Promise.withResolvers<string>();
					const held = Promise.withResolvers<void>();
					const turn = yield* agent
						.runTurn({
							prompt: 'background-shell',
							cwd: process.cwd(),
							backgroundTasks: holdOptions,
							onSessionId: sessionId.resolve,
							onEvent: () => held.resolve(),
						})
						.pipe(Effect.forkChild);
					const id = yield* Effect.promise(() => sessionId.promise);
					yield* Effect.promise(() => held.promise);
					const steerError = yield* agent
						.steer({ sessionId: id, text: 'next' })
						.pipe(
							Effect.retry({
								// Until the prompt returns the turn is still in flight, not held.
								while: (error) =>
									!error.message.includes('waiting for background tasks'),
								times: 20,
								schedule: Schedule.spaced('50 millis'),
							}),
							Effect.flip,
						);
					yield* Effect.sleep(200);
					const stillHeld = turn.pollUnsafe() === undefined;
					const released = yield* agent.releaseHold({ sessionId: id });
					const completed = yield* Fiber.join(turn);
					const releasedAgain = yield* agent.releaseHold({ sessionId: id });
					return { steerError, stillHeld, released, releasedAgain, completed };
				}),
			),
		);

		expect(result.steerError).toMatchObject({
			_tag: 'AcpSteerError',
			code: 'NOT_RUNNING',
		});
		expect(result.stillHeld).toBe(true);
		expect(result.released).toBe(true);
		expect(result.releasedAgain).toBe(false);
		expect(result.completed.text).toBe('waiting on the shell');
		expect(result.completed.stopReason).toBe('end_turn');
	});
});
