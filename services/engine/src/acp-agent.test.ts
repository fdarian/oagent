import { describe, expect, test } from 'bun:test';
import type {
	ClientSideConnection,
	SessionConfigOption,
} from '@agentclientprotocol/sdk';
import { Effect } from 'effect';
import { runAcpTurn } from './acp-agent.ts';

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

describe('ACP pre-prompt ordering', () => {
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
				expect(order).toEqual(['new-session', 'persist-session']);
				order.push('set-mode');
				return {} as SetConfigResult;
			},
			prompt: async (): Promise<PromptResult> => {
				expect(order).toEqual(['new-session', 'persist-session', 'set-mode']);
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
				},
			),
		);

		expect(result.sessionId).toBe('ses_test');
		expect(order).toEqual([
			'new-session',
			'persist-session',
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
				expect(order).toEqual(['load-session', 'persist-session']);
				order.push('set-mode');
				return {} as SetConfigResult;
			},
			prompt: async (): Promise<PromptResult> => {
				expect(order).toEqual(['load-session', 'persist-session', 'set-mode']);
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
				},
			),
		);

		expect(result.sessionId).toBe('ses_existing');
		expect(order).toEqual([
			'load-session',
			'persist-session',
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
});
