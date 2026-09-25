import { describe, expect, test } from 'bun:test';
import type {
	ClientSideConnection,
	SessionConfigOption,
	SessionUpdate,
} from '@agentclientprotocol/sdk';
import { Effect } from 'effect';
import {
	AcpForkNotSupportedError,
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
