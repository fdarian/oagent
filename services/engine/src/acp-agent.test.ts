import { describe, expect, test } from 'bun:test';
import type { ClientSideConnection } from '@agentclientprotocol/sdk';
import { Effect } from 'effect';
import { runAcpTurn } from './acp-agent.ts';

describe('ACP session persistence callback', () => {
	test('runs after session creation and before the prompt', async () => {
		const order: string[] = [];
		type NewSessionResult = Awaited<
			ReturnType<ClientSideConnection['newSession']>
		>;
		type PromptResult = Awaited<ReturnType<ClientSideConnection['prompt']>>;

		const conn = {
			newSession: async (): Promise<NewSessionResult> => {
				order.push('new-session');
				return { sessionId: 'ses_test' } as NewSessionResult;
			},
			prompt: async (): Promise<PromptResult> => {
				expect(order).toEqual(['new-session', 'persist-session']);
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
					skipModelSet: true,
					onSessionId: () => order.push('persist-session'),
				},
			),
		);

		expect(result.sessionId).toBe('ses_test');
		expect(order).toEqual(['new-session', 'persist-session', 'prompt']);
	});

	test('runs after session loading and before the prompt', async () => {
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
			prompt: async (): Promise<PromptResult> => {
				expect(order).toEqual(['load-session', 'persist-session']);
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
					skipModelSet: true,
					onSessionId: (sessionId) => {
						expect(sessionId).toBe('ses_existing');
						order.push('persist-session');
					},
				},
			),
		);

		expect(result.sessionId).toBe('ses_existing');
		expect(order).toEqual(['load-session', 'persist-session', 'prompt']);
	});
});
