import { describe, expect, test } from 'bun:test';
import type {
	ClientSideConnection,
	SessionUpdate,
} from '@agentclientprotocol/sdk';
import { Effect } from 'effect';
import { AcpSessionError, runAcpTurn } from './acp-agent.ts';

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
