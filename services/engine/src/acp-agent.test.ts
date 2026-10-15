import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import type {
	ClientSideConnection,
	SessionConfigOption,
	SessionUpdate,
} from '@agentclientprotocol/sdk';
import { Effect, Fiber, Schedule } from 'effect';
import {
	AcpForkNotSupportedError,
	createAcpConnection,
	forkAcpSession,
	makeAcpAgent,
	runAcpTurn,
} from './acp-agent.ts';

const SESSION_MODE_CONFIG_OPTIONS: Array<SessionConfigOption> = [
	{
		id: 'mode',
		name: 'Session Mode',
		category: 'mode',
		type: 'select',
		currentValue: 'build',
		options: [
			{ value: 'build', name: 'Build' },
			{ value: 'plan', name: 'Plan' },
		],
	},
];

test('returns only assistant text after the last tool call', async () => {
	type NewSessionResult = Awaited<
		ReturnType<ClientSideConnection['newSession']>
	>;
	type PromptResult = Awaited<ReturnType<ClientSideConnection['prompt']>>;
	const state = {
		listener: undefined as ((update: SessionUpdate) => void) | undefined,
	};
	const conn = {
		newSession: async (): Promise<NewSessionResult> =>
			({ sessionId: 'ses_test' }) as NewSessionResult,
		prompt: async (): Promise<PromptResult> => {
			const listener = state.listener;
			if (listener === undefined)
				throw new Error('session listener was not set');
			listener({
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'I will inspect the change.' },
			});
			listener({
				sessionUpdate: 'tool_call',
				toolCallId: 'tool-1',
				title: 'Inspect change',
			});
			listener({
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'The final answer' },
			});
			return { stopReason: 'end_turn' } as PromptResult;
		},
	} as unknown as ClientSideConnection;

	const result = await Effect.runPromise(
		runAcpTurn(
			{
				conn,
				registerListener: (_sessionId, listener) => {
					state.listener = listener;
					return () => {};
				},
				extNotificationHandlers: new Map(),
			},
			{ prompt: 'continue', cwd: '/tmp' },
		),
	);

	expect(result.text).toBe('The final answer');
});

test('ignores subagent output when collecting the result text and forwards sessionMeta to newSession', async () => {
	type NewSessionResult = Awaited<
		ReturnType<ClientSideConnection['newSession']>
	>;
	type PromptResult = Awaited<ReturnType<ClientSideConnection['prompt']>>;
	const state = {
		listener: undefined as ((update: SessionUpdate) => void) | undefined,
		newSessionMeta: undefined as unknown,
	};
	const subagentMeta = { claudeCode: { parentToolUseId: 'agent-1' } };
	const conn = {
		newSession: async (
			input: Parameters<ClientSideConnection['newSession']>[0],
		): Promise<NewSessionResult> => {
			state.newSessionMeta = input._meta;
			return { sessionId: 'ses_test' } as NewSessionResult;
		},
		prompt: async (): Promise<PromptResult> => {
			const listener = state.listener;
			if (listener === undefined)
				throw new Error('session listener was not set');
			listener({
				sessionUpdate: 'tool_call',
				toolCallId: 'agent-1',
				title: 'Task',
			});
			listener({
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'subagent text' },
				_meta: subagentMeta,
			});
			listener({
				sessionUpdate: 'tool_call',
				toolCallId: 'inner-1',
				title: 'Read',
				_meta: subagentMeta,
			});
			listener({
				sessionUpdate: 'tool_call_update',
				toolCallId: 'agent-1',
				_meta: subagentMeta,
			});
			listener({
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'The final answer' },
			});
			return { stopReason: 'end_turn' } as PromptResult;
		},
	} as unknown as ClientSideConnection;

	const sessionMeta = {
		claudeCode: { options: { forwardSubagentText: true } },
	};
	const result = await Effect.runPromise(
		runAcpTurn(
			{
				conn,
				registerListener: (_sessionId, listener) => {
					state.listener = listener;
					return () => {};
				},
				extNotificationHandlers: new Map(),
			},
			{ prompt: 'continue', cwd: '/tmp', sessionMeta },
		),
	);

	expect(result.text).toBe('The final answer');
	expect(state.newSessionMeta).toEqual(sessionMeta);
});

test('keeps the last text segment when a tool call ends the turn', async () => {
	type NewSessionResult = Awaited<
		ReturnType<ClientSideConnection['newSession']>
	>;
	type PromptResult = Awaited<ReturnType<ClientSideConnection['prompt']>>;
	const state = {
		listener: undefined as ((update: SessionUpdate) => void) | undefined,
	};
	const conn = {
		newSession: async (): Promise<NewSessionResult> =>
			({ sessionId: 'ses_test' }) as NewSessionResult,
		prompt: async (): Promise<PromptResult> => {
			const listener = state.listener;
			if (listener === undefined)
				throw new Error('session listener was not set');
			listener({
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'The final answer' },
			});
			listener({
				sessionUpdate: 'tool_call',
				toolCallId: 'tool-1',
				title: 'Update todo',
			});
			return { stopReason: 'end_turn' } as PromptResult;
		},
	} as unknown as ClientSideConnection;
	const result = await Effect.runPromise(
		runAcpTurn(
			{
				conn,
				registerListener: (_sessionId, listener) => {
					state.listener = listener;
					return () => {};
				},
				extNotificationHandlers: new Map(),
			},
			{ prompt: 'continue', cwd: '/tmp' },
		),
	);
	expect(result.text).toBe('The final answer');
});

describe('ACP pre-prompt ordering', () => {
	test('uses the model config option to list available models', async () => {
		type NewSessionResult = Awaited<
			ReturnType<ClientSideConnection['newSession']>
		>;
		const conn = {
			newSession: async (): Promise<NewSessionResult> =>
				({
					sessionId: 'ses_test',
					configOptions: [
						{
							id: 'model',
							name: 'Model',
							category: 'model',
							type: 'select',
							currentValue: 'model-a',
							options: [
								{ value: 'model-a', name: 'Model A' },
								{ value: 'model-b', name: 'Model B' },
							],
						},
					],
				}) as NewSessionResult,
			setSessionConfigOption: async () => {
				throw new Error('model is unavailable');
			},
			prompt: async () => {
				throw new Error('prompt must not run after setup fails');
			},
		} as unknown as ClientSideConnection;

		await expect(
			Effect.runPromise(
				runAcpTurn(
					{
						conn,
						registerListener: () => () => {},
						extNotificationHandlers: new Map(),
					},
					{
						prompt: 'continue',
						cwd: '/tmp',
						model: 'missing-model',
					},
				),
			),
		).rejects.toMatchObject({
			code: 'SET_CONFIG_OPTION',
			message: expect.stringContaining('available models: model-a, model-b'),
		});
	});

	test('finds the model config option by category when its id differs', async () => {
		type NewSessionResult = Awaited<
			ReturnType<ClientSideConnection['newSession']>
		>;
		const conn = {
			newSession: async (): Promise<NewSessionResult> =>
				({
					sessionId: 'ses_test',
					configOptions: [
						{
							id: 'model_selector',
							name: 'Model',
							category: 'model',
							type: 'select',
							currentValue: 'model-a',
							options: [
								{ value: 'model-a', name: 'Model A' },
								{ value: 'model-b', name: 'Model B' },
							],
						},
					],
				}) as NewSessionResult,
			setSessionConfigOption: async () => {
				throw new Error('model is unavailable');
			},
			prompt: async () => {
				throw new Error('prompt must not run after setup fails');
			},
		} as unknown as ClientSideConnection;

		await expect(
			Effect.runPromise(
				runAcpTurn(
					{
						conn,
						registerListener: () => () => {},
						extNotificationHandlers: new Map(),
					},
					{
						prompt: 'continue',
						cwd: '/tmp',
						model: 'missing-model',
					},
				),
			),
		).rejects.toMatchObject({
			code: 'SET_CONFIG_OPTION',
			message: expect.stringContaining('available models: model-a, model-b'),
		});
	});

	test('creates, persists, and configures a session before the prompt', async () => {
		const order: string[] = [];
		type NewSessionResult = Awaited<
			ReturnType<ClientSideConnection['newSession']>
		>;
		type PromptResult = Awaited<ReturnType<ClientSideConnection['prompt']>>;
		type SetConfigResult = Awaited<
			ReturnType<ClientSideConnection['setSessionConfigOption']>
		>;

		const conn = {
			newSession: async (): Promise<NewSessionResult> => {
				order.push('new-session');
				return {
					sessionId: 'ses_test',
					configOptions: SESSION_MODE_CONFIG_OPTIONS,
				} as NewSessionResult;
			},
			setSessionConfigOption: async (
				input: Parameters<ClientSideConnection['setSessionConfigOption']>[0],
			): Promise<SetConfigResult> => {
				expect(input).toEqual({
					sessionId: 'ses_test',
					configId: 'mode',
					value: 'plan',
				});
				expect(order).toEqual(['new-session', 'persist-session', 'setup']);
				order.push('set-mode');
				return {} as SetConfigResult;
			},
			prompt: async (): Promise<PromptResult> => {
				expect(order).toEqual([
					'new-session',
					'persist-session',
					'setup',
					'set-mode',
				]);
				order.push('prompt');
				return { stopReason: 'end_turn' } as PromptResult;
			},
		} as unknown as ClientSideConnection;

		const result = await Effect.runPromise(
			runAcpTurn(
				{
					conn,
					registerListener: () => () => {},
					extNotificationHandlers: new Map(),
				},
				{
					prompt: 'continue',
					cwd: '/tmp',
					mode: 'plan',
					onSessionId: () => order.push('persist-session'),
					beforePrompt: (sessionId) =>
						Effect.sync(() => {
							expect(sessionId).toBe('ses_test');
							order.push('setup');
						}),
				},
			),
		);

		expect(result.sessionId).toBe('ses_test');
		expect(order).toEqual([
			'new-session',
			'persist-session',
			'setup',
			'set-mode',
			'prompt',
		]);
	});

	test('loads, persists, and configures a session before the prompt', async () => {
		const order: string[] = [];
		type LoadSessionResult = Awaited<
			ReturnType<ClientSideConnection['loadSession']>
		>;
		type PromptResult = Awaited<ReturnType<ClientSideConnection['prompt']>>;
		type SetConfigResult = Awaited<
			ReturnType<ClientSideConnection['setSessionConfigOption']>
		>;

		const conn = {
			loadSession: async (): Promise<LoadSessionResult> => {
				order.push('load-session');
				return {} as LoadSessionResult;
			},
			setSessionConfigOption: async (
				input: Parameters<ClientSideConnection['setSessionConfigOption']>[0],
			): Promise<SetConfigResult> => {
				expect(input).toEqual({
					sessionId: 'ses_existing',
					configId: 'mode',
					value: 'build',
				});
				expect(order).toEqual(['load-session', 'persist-session', 'setup']);
				order.push('set-mode');
				return {} as SetConfigResult;
			},
			prompt: async (): Promise<PromptResult> => {
				expect(order).toEqual([
					'load-session',
					'persist-session',
					'setup',
					'set-mode',
				]);
				order.push('prompt');
				return { stopReason: 'end_turn' } as PromptResult;
			},
		} as unknown as ClientSideConnection;

		const result = await Effect.runPromise(
			runAcpTurn(
				{
					conn,
					registerListener: () => () => {},
					extNotificationHandlers: new Map(),
				},
				{
					prompt: 'continue',
					cwd: '/tmp',
					sessionId: 'ses_existing',
					mode: 'build',
					onSessionId: (sessionId) => {
						expect(sessionId).toBe('ses_existing');
						order.push('persist-session');
					},
					beforePrompt: (sessionId) =>
						Effect.sync(() => {
							expect(sessionId).toBe('ses_existing');
							order.push('setup');
						}),
				},
			),
		);

		expect(result.sessionId).toBe('ses_existing');
		expect(order).toEqual([
			'load-session',
			'persist-session',
			'setup',
			'set-mode',
			'prompt',
		]);
	});

	test('uses the unlisted-mode fallback before the prompt', async () => {
		const order: string[] = [];
		type NewSessionResult = Awaited<
			ReturnType<ClientSideConnection['newSession']>
		>;
		type PromptResult = Awaited<ReturnType<ClientSideConnection['prompt']>>;

		const conn = {
			newSession: async (): Promise<NewSessionResult> => {
				order.push('new-session');
				return {
					sessionId: 'ses_test',
					configOptions: SESSION_MODE_CONFIG_OPTIONS,
				} as NewSessionResult;
			},
			setSessionConfigOption: async () => {
				throw new Error('ACP mode selection should not run');
			},
			prompt: async (): Promise<PromptResult> => {
				expect(order).toEqual([
					'new-session',
					'persist-session',
					'set-unlisted-mode',
				]);
				order.push('prompt');
				return { stopReason: 'end_turn' } as PromptResult;
			},
		} as unknown as ClientSideConnection;

		const result = await Effect.runPromise(
			runAcpTurn(
				{
					conn,
					registerListener: () => () => {},
					extNotificationHandlers: new Map(),
				},
				{
					prompt: 'continue',
					cwd: '/tmp',
					mode: 'oracle',
					onSessionId: () => order.push('persist-session'),
					setUnlistedMode: (input) =>
						Effect.sync(() => {
							expect(input).toEqual({
								sessionId: 'ses_test',
								mode: 'oracle',
							});
							order.push('set-unlisted-mode');
						}),
				},
			),
		);

		expect(result.sessionId).toBe('ses_test');
		expect(order).toEqual([
			'new-session',
			'persist-session',
			'set-unlisted-mode',
			'prompt',
		]);
	});

	test('marks prompt dispatch after the ACP prompt invocation', async () => {
		const order: string[] = [];
		type LoadSessionResult = Awaited<
			ReturnType<ClientSideConnection['loadSession']>
		>;
		type PromptResult = Awaited<ReturnType<ClientSideConnection['prompt']>>;

		const conn = {
			loadSession: async (): Promise<LoadSessionResult> => {
				order.push('load-session');
				return {} as LoadSessionResult;
			},
			setSessionConfigOption: async () => {
				order.push('set-config');
			},
			prompt: async (): Promise<PromptResult> => {
				expect(order).toEqual(['load-session', 'set-config']);
				order.push('prompt');
				return { stopReason: 'end_turn' } as PromptResult;
			},
		} as unknown as ClientSideConnection;

		await Effect.runPromise(
			runAcpTurn(
				{
					conn,
					registerListener: () => () => {},
					extNotificationHandlers: new Map(),
				},
				{
					prompt: 'continue',
					cwd: '/tmp',
					sessionId: 'ses_existing',
					model: 'provider/model',
					onPromptDispatch: () => order.push('prompt-dispatch'),
				},
			),
		);

		expect(order).toEqual([
			'load-session',
			'set-config',
			'prompt',
			'prompt-dispatch',
		]);
	});

	test('does not mark prompt dispatch when setup fails', async () => {
		let promptDispatched = false;
		type LoadSessionResult = Awaited<
			ReturnType<ClientSideConnection['loadSession']>
		>;
		const conn = {
			loadSession: async (): Promise<LoadSessionResult> =>
				({}) as LoadSessionResult,
			setSessionConfigOption: async () => {
				throw new Error('model is unavailable');
			},
			prompt: async () => {
				throw new Error('prompt must not be called');
			},
		} as unknown as ClientSideConnection;

		await expect(
			Effect.runPromise(
				runAcpTurn(
					{
						conn,
						registerListener: () => () => {},
						extNotificationHandlers: new Map(),
					},
					{
						prompt: 'continue',
						cwd: '/tmp',
						sessionId: 'ses_existing',
						model: 'provider/model',
						onPromptDispatch: () => {
							promptDispatched = true;
						},
					},
				),
			),
		).rejects.toMatchObject({ code: 'SET_CONFIG_OPTION' });
		expect(promptDispatched).toBe(false);
	});

	test('leaves prompt dispatch unmarked when prompt invocation throws', async () => {
		let promptDispatched = false;
		type LoadSessionResult = Awaited<
			ReturnType<ClientSideConnection['loadSession']>
		>;
		const conn = {
			loadSession: async (): Promise<LoadSessionResult> =>
				({}) as LoadSessionResult,
			prompt: () => {
				throw new Error('connection is closed');
			},
		} as unknown as ClientSideConnection;

		await expect(
			Effect.runPromise(
				runAcpTurn(
					{
						conn,
						registerListener: () => () => {},
						extNotificationHandlers: new Map(),
					},
					{
						prompt: 'continue',
						cwd: '/tmp',
						sessionId: 'ses_existing',
						skipModelSet: true,
						onPromptDispatch: () => {
							promptDispatched = true;
						},
					},
				),
			),
		).rejects.toMatchObject({ code: 'PROMPT_REJECTED' });
		expect(promptDispatched).toBe(false);
	});

	test('treats a rejected prompt request returned from ACP as dispatched', async () => {
		let promptDispatched = false;
		type LoadSessionResult = Awaited<
			ReturnType<ClientSideConnection['loadSession']>
		>;
		type PromptResult = Awaited<ReturnType<ClientSideConnection['prompt']>>;
		const conn = {
			loadSession: async (): Promise<LoadSessionResult> =>
				({}) as LoadSessionResult,
			prompt: (): Promise<PromptResult> =>
				Promise.reject(new Error('request rejected')),
		} as unknown as ClientSideConnection;

		await expect(
			Effect.runPromise(
				runAcpTurn(
					{
						conn,
						registerListener: () => () => {},
						extNotificationHandlers: new Map(),
					},
					{
						prompt: 'continue',
						cwd: '/tmp',
						sessionId: 'ses_existing',
						skipModelSet: true,
						onPromptDispatch: () => {
							promptDispatched = true;
						},
					},
				),
			),
		).rejects.toMatchObject({ code: 'PROMPT_REJECTED' });
		expect(promptDispatched).toBe(true);
	});
});

describe('ACP session fork', () => {
	test('calls session/fork only when the agent advertises support', async () => {
		type ForkSessionResult = Awaited<
			ReturnType<ClientSideConnection['unstable_forkSession']>
		>;
		let request:
			| Parameters<ClientSideConnection['unstable_forkSession']>[0]
			| undefined;
		const conn = {
			unstable_forkSession: async (
				input: Parameters<ClientSideConnection['unstable_forkSession']>[0],
			): Promise<ForkSessionResult> => {
				request = input;
				return { sessionId: 'ses_forked' } as ForkSessionResult;
			},
		} as unknown as ClientSideConnection;

		const result = await Effect.runPromise(
			forkAcpSession(
				{
					conn,
					agentCapabilities: { sessionCapabilities: { fork: {} } },
				},
				{ sessionId: 'ses_source', cwd: '/workspace' },
			),
		);

		expect(result).toEqual({ sessionId: 'ses_forked' });
		expect(request).toEqual({
			sessionId: 'ses_source',
			cwd: '/workspace',
			mcpServers: [],
		});
	});

	test('rejects an unadvertised session/fork capability', async () => {
		const conn = {
			unstable_forkSession: async () => {
				throw new Error('session/fork should not be called');
			},
		} as unknown as ClientSideConnection;

		await expect(
			Effect.runPromise(
				forkAcpSession(
					{ conn, agentCapabilities: undefined },
					{ sessionId: 'ses_source', cwd: '/workspace' },
				),
			),
		).rejects.toBeInstanceOf(AcpForkNotSupportedError);
	});
});

describe('shared ACP connection', () => {
	test('respawns the harness when the cached process dies between turns', async () => {
		const runTurn = (agent: Effect.Success<ReturnType<typeof makeAcpAgent>>) =>
			agent
				.runTurn({ prompt: 'pid?', cwd: process.cwd() })
				.pipe(Effect.map((result) => Number(result.text)));

		const pids = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* makeAcpAgent({
						binary: process.execPath,
						args: [
							fileURLToPath(new URL('./test-acp-agent.ts', import.meta.url)),
						],
						clientInfoName: 'oagent-test',
					});
					const first = yield* runTurn(agent);
					process.kill(first, 'SIGKILL');
					yield* Effect.sleep('200 millis');
					const second = yield* runTurn(agent);
					return { first, second };
				}),
			),
		);

		expect(pids.second).not.toBe(pids.first);
	});
});

describe('ACP steering', () => {
	const agentScript = fileURLToPath(
		new URL('./test-acp-agent.ts', import.meta.url),
	);
	const makeAgent = (env?: Record<string, string>) =>
		makeAcpAgent({
			binary: process.execPath,
			args: [agentScript],
			clientInfoName: 'oagent-test',
			...(env === undefined ? {} : { env }),
		});

	test('injects a message into the running turn, which then completes', async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* makeAgent();
					const sessionId = Promise.withResolvers<string>();
					const events: Array<SessionUpdate> = [];
					const turn = yield* agent
						.runTurn({
							prompt: 'wait-for-steer',
							cwd: process.cwd(),
							onSessionId: sessionId.resolve,
							onEvent: (event) => events.push(event),
						})
						.pipe(Effect.forkChild);
					const id = yield* Effect.promise(() => sessionId.promise);
					// onSessionId fires before the turn is registered as steerable.
					const steered = yield* agent
						.steer({ sessionId: id, text: 'also this' })
						.pipe(
							Effect.retry({
								while: (error) => error.code === 'NOT_RUNNING',
								times: 20,
								schedule: Schedule.spaced('50 millis'),
							}),
						);
					const completed = yield* Fiber.join(turn);
					return { steered, completed, events };
				}),
			),
		);

		expect(result.steered.text).toBe('also this');
		expect(result.completed.stopReason).toBe('end_turn');
		expect(result.completed.text).toBe('steered:also this');
	});

	test('fails NOT_RUNNING when no turn is active for the session', async () => {
		const error = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* makeAgent();
					return yield* agent
						.steer({ sessionId: 'ses_idle', text: 'hello' })
						.pipe(Effect.flip);
				}),
			),
		);
		expect(error).toMatchObject({
			_tag: 'AcpSteerError',
			code: 'NOT_RUNNING',
		});
	});

	test('fails UNSUPPORTED_VERSION when the adapter does not advertise steering', async () => {
		const error = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* makeAgent({ TEST_ACP_NO_STEERING: '1' });
					const sessionId = Promise.withResolvers<string>();
					const turn = yield* agent
						.runTurn({
							prompt: 'wait-for-steer',
							cwd: process.cwd(),
							onSessionId: sessionId.resolve,
						})
						.pipe(Effect.forkChild);
					const id = yield* Effect.promise(() => sessionId.promise);
					const failure = yield* agent
						.steer({ sessionId: id, text: 'hello' })
						.pipe(
							Effect.retry({
								while: (error) => error.code === 'NOT_RUNNING',
								times: 20,
								schedule: Schedule.spaced('50 millis'),
							}),
							Effect.flip,
						);
					yield* Fiber.interrupt(turn);
					return failure;
				}),
			),
		);
		expect(error).toMatchObject({
			_tag: 'AcpSteerError',
			code: 'UNSUPPORTED_VERSION',
		});
	});
});

describe('native subagent sessions', () => {
	const agentScript = fileURLToPath(
		new URL('./test-native-subagent-acp-agent.ts', import.meta.url),
	);
	const connect = (nativeSubagents: boolean) =>
		createAcpConnection({
			binary: process.execPath,
			args: [agentScript],
			clientInfoName: 'oagent-test',
			nativeSubagents,
		});
	const prompt = (
		connection: Effect.Success<ReturnType<typeof connect>>,
		text: string,
	) =>
		Effect.promise(async () => {
			const session = await connection.conn.newSession({
				cwd: '/tmp',
				mcpServers: [],
			});
			return connection.conn.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: 'text', text }],
			});
		});

	test('routes child session updates to the root listener with subagent meta', async () => {
		const events = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const connection = yield* connect(true);
					const received: Array<SessionUpdate> = [];
					connection.registerListener('root', (update) =>
						received.push(update),
					);
					yield* prompt(connection, 'go');
					return received;
				}),
			),
		);

		const [capabilities, spawned, childText, nested, grandchildText, ...rest] =
			events;
		expect(
			JSON.parse((capabilities as { content: { text: string } }).content.text),
		).toMatchObject({ subagents: {} });

		expect(spawned).toMatchObject({
			sessionUpdate: 'subagent_update',
			sessionId: 'child',
			title: 'Explore repo',
			description: 'Explore repo',
			state: { state: 'running' },
			_meta: {
				'oagent/subagent': { sessionId: 'child', parentSessionId: null },
			},
		});
		expect(childText).toMatchObject({
			sessionUpdate: 'agent_message_chunk',
			content: { text: 'child text' },
			_meta: {
				claudeCode: { parentToolUseId: 'toolu_1' },
				'oagent/subagent': { sessionId: 'child', parentSessionId: null },
			},
		});
		expect(nested).toMatchObject({
			sessionUpdate: 'subagent_update',
			sessionId: 'grandchild',
			_meta: {
				'oagent/subagent': {
					sessionId: 'grandchild',
					parentSessionId: 'child',
				},
			},
		});
		expect(grandchildText).toMatchObject({
			content: { text: 'grandchild text' },
			_meta: {
				'oagent/subagent': {
					sessionId: 'grandchild',
					parentSessionId: 'child',
				},
			},
		});
		expect(rest).toMatchObject([
			{
				sessionUpdate: 'subagent_update',
				sessionId: 'grandchild',
				state: { state: 'completed' },
				_meta: {
					'oagent/subagent': {
						sessionId: 'grandchild',
						parentSessionId: 'child',
					},
				},
			},
			{
				sessionUpdate: 'subagent_update',
				sessionId: 'child',
				state: { state: 'failed' },
				_meta: {
					'oagent/subagent': { sessionId: 'child', parentSessionId: null },
				},
			},
		]);
	});

	test('does not advertise native subagents unless configured', async () => {
		const events = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const connection = yield* connect(false);
					const received: Array<SessionUpdate> = [];
					connection.registerListener('root', (update) =>
						received.push(update),
					);
					yield* prompt(connection, 'go');
					return received;
				}),
			),
		);

		const first = events[0] as { content: { text: string } };
		expect(JSON.parse(first.content.text)).not.toHaveProperty('subagents');
	});

	test('keeps subagent output out of the turn result text', async () => {
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const connection = yield* connect(true);
					return yield* runAcpTurn(connection, { prompt: 'go', cwd: '/tmp' });
				}),
			),
		);

		expect(JSON.parse(result.text)).toMatchObject({ subagents: {} });
	});

	test('resolves a child session permission request to the root turn', async () => {
		const permissionOutcomes = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const connection = yield* connect(true);
					const received: Array<SessionUpdate> = [];
					connection.registerListener('root', (update) =>
						received.push(update),
					);
					yield* prompt(connection, 'go');
					yield* prompt(connection, 'permission');
					connection.cancelPermissions('root');
					yield* prompt(connection, 'permission');
					return received.slice(-2).map((update) => {
						if (update.sessionUpdate !== 'agent_message_chunk') {
							throw new Error('expected a message chunk');
						}
						if (update.content.type !== 'text') {
							throw new Error('expected text content');
						}
						return JSON.parse(update.content.text);
					});
				}),
			),
		);

		expect(permissionOutcomes).toEqual([
			{ outcome: 'selected', optionId: 'allow' },
			{ outcome: 'cancelled' },
		]);
	});
});
