import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import type {
	ClientSideConnection,
	SessionUpdate,
} from '@agentclientprotocol/sdk';
import { Effect, Fiber, Schedule } from 'effect';
import { makeAcpAgent, runAcpTurn } from './acp-agent.ts';

const SESSION_ID = 'ses_claude';
const SETTLE_MS = 50;

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

const shell = { task_id: 'shell-1', task_type: 'local_bash' };

function createFakeClaude(
	prompt: (input: {
		update: (event: SessionUpdate) => void;
		raw: (params: unknown) => void;
	}) => Promise<void>,
) {
	const state = {
		listener: undefined as ((update: SessionUpdate) => void) | undefined,
		cancelled: 0,
	};
	const extNotificationHandlers = new Map<
		string,
		(method: string, params: unknown) => void
	>();
	const conn = {
		newSession: async (): Promise<NewSessionResult> =>
			({ sessionId: SESSION_ID }) as NewSessionResult,
		prompt: async (): Promise<PromptResult> => {
			await prompt({
				update: (event) => state.listener?.(event),
				raw: (params) =>
					extNotificationHandlers.get(SESSION_ID)?.(
						'_claude/sdkMessage',
						params,
					),
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

const runClaudeTurn = (fake: ReturnType<typeof createFakeClaude>) => {
	const events: Array<SessionUpdate> = [];
	return {
		events,
		run: runAcpTurn(fake.env, {
			prompt: 'go',
			cwd: '/tmp',
			backgroundTasks: { settleMs: SETTLE_MS },
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

	test('does not hold for subagents, monitors, or ambient tasks', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(
				tasksChanged([
					{ task_id: 'a', task_type: 'local_agent' },
					{ task_id: 'm', task_type: 'local_monitor' },
					{ task_id: 'w', task_type: 'local_bash', ambient: true },
				]),
			);
			input.update(text('all done'));
		});

		const result = await Effect.runPromise(runClaudeTurn(fake).run);

		expect(result.text).toBe('all done');
	});

	test('holds until tasks are empty and the SDK is idle, then reports the follow-up text', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shell]));
			input.update(text('waiting on the shell'));
			later(20, () => input.raw(tasksChanged([])));
			// Idle but not yet running again: the debounce must outlast this gap.
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
		expect(turn.events.map((event) => event.sessionUpdate)).toEqual([
			'agent_message_chunk',
			'agent_message_chunk',
		]);
	});

	test('keeps holding while a follow-up cycle starts another background task', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shell]));
			input.update(text('waiting on the shell'));
			later(10, () => input.raw(tasksChanged([])));
			later(20, () => input.raw(sessionState('running')));
			later(30, () =>
				input.raw(tasksChanged([{ ...shell, task_id: 'shell-2' }])),
			);
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

	test('cancels the session when the held turn is interrupted', async () => {
		const fake = createFakeClaude(async (input) => {
			input.raw(tasksChanged([shell]));
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

describe('Claude background task hold through the ACP agent', () => {
	const agentScript = fileURLToPath(
		new URL('./test-acp-agent.ts', import.meta.url),
	);
	const makeAgent = () =>
		makeAcpAgent({
			binary: process.execPath,
			args: [agentScript],
			clientInfoName: 'oagent-test',
		});

	test('records the autonomous follow-up cycle into the same turn', async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* makeAgent();
					const events: Array<SessionUpdate> = [];
					const completed = yield* agent.runTurn({
						prompt: 'background-shell:finish',
						cwd: process.cwd(),
						backgroundTasks: { settleMs: SETTLE_MS },
						onEvent: (event) => events.push(event),
					});
					return { completed, events };
				}),
			),
		);

		expect(result.completed.text).toBe('shell finished');
		expect(result.completed.stopReason).toBe('end_turn');
		expect(
			result.events.map((event) =>
				event.sessionUpdate === 'agent_message_chunk' &&
				event.content.type === 'text'
					? event.content.text
					: undefined,
			),
		).toEqual(['waiting on the shell', 'shell finished']);
	});

	test('ends a held turn as done with its current text when a new message arrives', async () => {
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
							backgroundTasks: { settleMs: SETTLE_MS },
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
					const completed = yield* Fiber.join(turn);
					return { steerError, completed };
				}),
			),
		);

		expect(result.steerError).toMatchObject({
			_tag: 'AcpSteerError',
			code: 'NOT_RUNNING',
		});
		expect(result.completed.text).toBe('waiting on the shell');
		expect(result.completed.stopReason).toBe('end_turn');
	});
});
