import { describe, expect, test } from 'bun:test';
import type {
	ClientSideConnection,
	SessionConfigOption,
	SessionUpdate,
} from '@agentclientprotocol/sdk';
import { Effect } from 'effect';
import {
	AcpForkNotSupportedError,
	AcpSessionError,
	forkAcpSession,
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

type TestConnection = {
	env: {
		conn: ClientSideConnection;
		registerListener: (
			sessionId: string,
			fn: (event: SessionUpdate) => void,
		) => () => void;
		extNotificationHandlers: Map<
			string,
			(method: string, params: unknown) => void
		>;
		processExited: Promise<number>;
		close: () => void;
		agentInfo: undefined;
		agentCapabilities: undefined;
		emit: (sessionId: string, event: SessionUpdate) => void;
	};
	resolveExit: (code: number) => void;
};

function createTestConnection(input: {
	prompt: () => Promise<Awaited<ReturnType<ClientSideConnection['prompt']>>>;
	loadSession?: (
		listener: ((event: SessionUpdate) => void) | undefined,
	) => Promise<Awaited<ReturnType<ClientSideConnection['loadSession']>>>;
}): TestConnection {
	const listeners = new Map<string, (event: SessionUpdate) => void>();
	let resolveExit: (code: number) => void = () => {};
	const processExited = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const conn = {
		loadSession: async (
			params: Parameters<ClientSideConnection['loadSession']>[0],
		) => {
			const listener = listeners.get(params.sessionId);
			if (input.loadSession !== undefined) {
				return input.loadSession(listener);
			}
			return {} as Awaited<ReturnType<ClientSideConnection['loadSession']>>;
		},
		prompt: input.prompt,
		cancel: async () => {},
	} as unknown as ClientSideConnection;

	return {
		env: {
			conn,
			registerListener: (sessionId, listener) => {
				listeners.set(sessionId, listener);
				return () => listeners.delete(sessionId);
			},
			extNotificationHandlers: new Map(),
			processExited,
			close: () => {},
			agentInfo: undefined,
			agentCapabilities: undefined,
			emit: (sessionId, event) => listeners.get(sessionId)?.(event),
		},
		resolveExit,
	};
}

describe('ACP pre-prompt ordering', () => {
	test('uses model config options when the session omits top-level models', async () => {
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

describe('ACP turn recovery', () => {
	test('reconnects after process exit and replays updates on the same turn', async () => {
		let resolvePrompt: (
			result: Awaited<ReturnType<ClientSideConnection['prompt']>>,
		) => void = () => {};
		const previousEvent: SessionUpdate = {
			sessionUpdate: 'agent_message_chunk',
			messageId: 'msg_previous',
			content: { type: 'text', text: 'previous' },
		};
		const replayedEvent: SessionUpdate = {
			sessionUpdate: 'agent_message_chunk',
			messageId: 'msg_replayed',
			content: { type: 'text', text: 'replayed' },
		};
		const first = createTestConnection({
			prompt: () =>
				new Promise<Awaited<ReturnType<ClientSideConnection['prompt']>>>(
					(resolve) => {
						resolvePrompt = resolve;
					},
				),
			loadSession: async (listener) => {
				listener?.(previousEvent);
				return {} as Awaited<ReturnType<ClientSideConnection['loadSession']>>;
			},
		});
		const second = createTestConnection({
			prompt: async () => ({ stopReason: 'end_turn' }),
			loadSession: async (listener) => {
				listener?.(previousEvent);
				listener?.(replayedEvent);
				return {} as Awaited<ReturnType<ClientSideConnection['loadSession']>>;
			},
		});
		const events: SessionUpdate[] = [];
		let busyChecks = 0;

		const resultPromise = Effect.runPromise(
			runAcpTurn(
				{
					...first.env,
					createConnection: () => Effect.succeed(second.env),
				},
				{
					prompt: 'continue',
					cwd: '/tmp',
					sessionId: 'ses_existing',
					skipModelSet: true,
					onEvent: (event) => events.push(event),
					recovery: {
						stallTimeoutMs: 10_000,
						pollIntervalMs: 1,
						maxRetries: 2,
						isSessionBusy: () => {
							busyChecks += 1;
							return Effect.succeed(false);
						},
					},
				},
			),
		);

		await Bun.sleep(0);
		first.resolveExit(1);
		const result = await resultPromise;
		resolvePrompt({ stopReason: 'end_turn' });

		expect(result).toEqual({
			sessionId: 'ses_existing',
			text: 'replayed',
			stopReason: 'end_turn',
		});
		expect(events).toEqual([replayedEvent]);
		expect(busyChecks).toBe(1);
	});

	test('converts a replayed full message into only the missed text suffix', async () => {
		const liveEvent: SessionUpdate = {
			sessionUpdate: 'agent_message_chunk',
			messageId: 'msg_current',
			content: { type: 'text', text: 'hel' },
		};
		const first = createTestConnection({
			prompt: () =>
				new Promise<Awaited<ReturnType<ClientSideConnection['prompt']>>>(
					() => {},
				),
		});
		const second = createTestConnection({
			prompt: async () => ({ stopReason: 'end_turn' }),
			loadSession: async (listener) => {
				listener?.({
					sessionUpdate: 'agent_message_chunk',
					messageId: 'msg_current',
					content: { type: 'text', text: 'hello' },
				});
				return {} as Awaited<ReturnType<ClientSideConnection['loadSession']>>;
			},
		});
		const events: SessionUpdate[] = [];

		const resultPromise = Effect.runPromise(
			runAcpTurn(
				{
					...first.env,
					createConnection: () => Effect.succeed(second.env),
				},
				{
					prompt: 'continue',
					cwd: '/tmp',
					sessionId: 'ses_existing',
					skipModelSet: true,
					onEvent: (event) => events.push(event),
					recovery: {
						pollIntervalMs: 1,
						maxRetries: 2,
						isSessionBusy: () => Effect.succeed(false),
					},
				},
			),
		);

		await Bun.sleep(0);
		first.env.emit('ses_existing', liveEvent);
		first.resolveExit(1);

		const result = await resultPromise;

		expect(result).toEqual({
			sessionId: 'ses_existing',
			text: 'hello',
			stopReason: 'end_turn',
		});
		expect(events).toEqual([
			liveEvent,
			{
				sessionUpdate: 'agent_message_chunk',
				messageId: 'msg_current',
				content: { type: 'text', text: 'lo' },
			},
		]);
	});

	test('fails after bounded reconnect attempts instead of staying running', async () => {
		const first = createTestConnection({
			prompt: () =>
				new Promise<Awaited<ReturnType<ClientSideConnection['prompt']>>>(
					() => {},
				),
		});
		let reconnectAttempts = 0;
		const resultPromise = Effect.runPromise(
			runAcpTurn(
				{
					...first.env,
					createConnection: () => {
						reconnectAttempts += 1;
						return Effect.fail(
							new AcpSessionError({
								cause: new Error('replacement unavailable'),
							}),
						);
					},
				},
				{
					prompt: 'continue',
					cwd: '/tmp',
					sessionId: 'ses_existing',
					skipModelSet: true,
					recovery: {
						pollIntervalMs: 1,
						maxRetries: 2,
						isSessionBusy: () => Effect.succeed(true),
					},
				},
			),
		);

		await Bun.sleep(0);
		first.resolveExit(1);

		await expect(resultPromise).rejects.toMatchObject({
			code: 'ACP_RECOVERY_FAILED',
		});
		expect(reconnectAttempts).toBe(2);
	});

	test('reconnects when a busy session stops producing updates', async () => {
		const first = createTestConnection({
			prompt: () =>
				new Promise<Awaited<ReturnType<ClientSideConnection['prompt']>>>(
					() => {},
				),
		});
		const second = createTestConnection({
			prompt: async () => ({ stopReason: 'end_turn' }),
			loadSession: async (listener) => {
				listener?.({
					sessionUpdate: 'agent_thought_chunk',
					messageId: 'msg_stall_replay:reasoning:0',
					content: { type: 'text', text: 'recovered' },
				});
				return {} as Awaited<ReturnType<ClientSideConnection['loadSession']>>;
			},
		});
		let busyChecks = 0;

		const resultPromise = Effect.runPromise(
			runAcpTurn(
				{
					...first.env,
					createConnection: () => Effect.succeed(second.env),
				},
				{
					prompt: 'continue',
					cwd: '/tmp',
					sessionId: 'ses_existing',
					skipModelSet: true,
					recovery: {
						stallTimeoutMs: 5,
						pollIntervalMs: 1,
						maxRetries: 2,
						isSessionBusy: () => {
							busyChecks += 1;
							return Effect.succeed(busyChecks === 1);
						},
					},
				},
			),
		);

		const result = await resultPromise;

		expect(result.sessionId).toBe('ses_existing');
		expect(busyChecks).toBe(2);
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
