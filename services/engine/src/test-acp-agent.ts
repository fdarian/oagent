/**
 * Minimal ACP agent subprocess for tests; each prompt replies with its pid.
 * A prompt with the text `wait-for-steer` stays in flight until a
 * `_session/steering` request arrives, then answers the steered text.
 * Set `TEST_ACP_NO_STEERING=1` to omit the steering capability.
 * Set `TEST_ACP_MODELS=a,b` to report a model config option (first is the
 * default) and append the session's model to each reply as `<pid>:<model>`.
 * Set `TEST_ACP_MODEL_CONFIG_ID=x` to name that option `x` instead of `model`;
 * setting `model` then fails like an adapter rejecting an unknown option.
 * Set `TEST_ACP_FORK=1` to advertise `session/fork` and `session/load`.
 *
 * A prompt starting with `background-shell` mimics Claude launching a background
 * Bash: it reports the task through `_claude/sdkMessage` and the Bash tool
 * result's `backgroundTaskId`, answers "waiting" and ends the turn.
 * `background-shell:finish` then ends the shell 100ms later and runs an
 * autonomous follow-up cycle answering "shell finished"; plain
 * `background-shell` never finishes. `background-shell:slow-finish` does the
 * same with a follow-up cycle that stays running for 600ms before answering,
 * and `background-shell:exit` kills the process 100ms after the turn ended.
 * A `finish-shell` prompt, sent on a later turn, answers "ok" and ends the
 * still-running shell the same way. Like the real adapter, the main turn
 * reports SDK state `running` while it works and `idle` once it ends.
 */
import {
	AgentSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';

const output = new WritableStream<Uint8Array>({
	write: (chunk) => {
		process.stdout.write(chunk);
	},
});

const models = (process.env.TEST_ACP_MODELS ?? '')
	.split(',')
	.filter((model) => model !== '');
const modelConfigId = process.env.TEST_ACP_MODEL_CONFIG_ID ?? 'model';
const sessionModels = new Map<string, string>();

const configOptionsFor = (sessionId: string) =>
	models.length === 0
		? undefined
		: [
				{
					id: modelConfigId,
					name: 'Model',
					category: 'model',
					type: 'select' as const,
					currentValue: sessionModels.get(sessionId) ?? models[0] ?? '',
					options: models.map((model) => ({ value: model, name: model })),
				},
			];

const sdkMessage = (
	conn: AgentSideConnection,
	sessionId: string,
	message: Record<string, unknown>,
) => conn.extNotification('_claude/sdkMessage', { sessionId, message });

const finishShell = (
	conn: AgentSideConnection,
	sessionId: string,
	cycleMs = 0,
) =>
	setTimeout(async () => {
		await sdkMessage(conn, sessionId, {
			type: 'system',
			subtype: 'background_tasks_changed',
			tasks: [],
		});
		await sdkMessage(conn, sessionId, {
			type: 'system',
			subtype: 'session_state_changed',
			state: 'running',
		});
		await conn.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'shell finished' },
			},
		});
		await Bun.sleep(cycleMs);
		await sdkMessage(conn, sessionId, {
			type: 'system',
			subtype: 'session_state_changed',
			state: 'idle',
		});
	}, 100);

const inFlight = new Map<string, (steeredText: string) => Promise<void>>();
const cancelInFlight = new Map<string, () => void>();

new AgentSideConnection(
	(conn) => ({
		initialize: async () => ({
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities:
				process.env.TEST_ACP_FORK === '1'
					? { loadSession: true, sessionCapabilities: { fork: {} } }
					: {},
			...(process.env.TEST_ACP_NO_STEERING === '1'
				? {}
				: { _meta: { steering: { supported: true } } }),
		}),
		newSession: async () => {
			const sessionId = crypto.randomUUID();
			return { sessionId, configOptions: configOptionsFor(sessionId) };
		},
		loadSession: async (params) => ({
			configOptions: configOptionsFor(params.sessionId),
		}),
		unstable_forkSession: async (params) => {
			const sessionId = crypto.randomUUID();
			const model = sessionModels.get(params.sessionId);
			if (model !== undefined) sessionModels.set(sessionId, model);
			return { sessionId };
		},
		setSessionConfigOption: async (params) => {
			if (params.configId === modelConfigId) {
				sessionModels.set(params.sessionId, String(params.value));
			} else if (params.configId === 'model') {
				throw new Error('Unknown config option: model');
			}
			return { configOptions: configOptionsFor(params.sessionId) ?? [] };
		},
		authenticate: async () => ({}),
		cancel: async (params) => {
			cancelInFlight.get(params.sessionId)?.();
		},
		extMethod: async (method, params) => {
			if (method !== '_session/steering') {
				throw new Error(`Unhandled extension method: ${method}`);
			}
			const sessionId = String(params.sessionId);
			const prompt = params.prompt as Array<{ text: string }>;
			const answer = inFlight.get(sessionId);
			if (answer === undefined) {
				return { outcome: 'promptRequired', reason: 'noRunningTurn' };
			}
			await answer(prompt.map((block) => block.text).join(''));
			return { outcome: 'injected' };
		},
		prompt: async (params) => {
			const first = params.prompt[0];
			if (first?.type === 'text' && first.text === 'wait-for-steer') {
				const steered = Promise.withResolvers<void>();
				inFlight.set(params.sessionId, async (steeredText) => {
					await conn.sessionUpdate({
						sessionId: params.sessionId,
						update: {
							sessionUpdate: 'agent_message_chunk',
							content: { type: 'text', text: `steered:${steeredText}` },
						},
					});
					steered.resolve();
				});
				cancelInFlight.set(params.sessionId, steered.resolve);
				await steered.promise;
				inFlight.delete(params.sessionId);
				cancelInFlight.delete(params.sessionId);
				return { stopReason: 'end_turn' };
			}
			if (first?.type === 'text' && first.text.startsWith('background-shell')) {
				await sdkMessage(conn, params.sessionId, {
					type: 'system',
					subtype: 'session_state_changed',
					state: 'running',
				});
				await sdkMessage(conn, params.sessionId, {
					type: 'system',
					subtype: 'background_tasks_changed',
					tasks: [{ task_id: 'shell-1', task_type: 'local_bash' }],
				});
				await conn.sessionUpdate({
					sessionId: params.sessionId,
					update: {
						sessionUpdate: 'tool_call_update',
						toolCallId: 'bash-1',
						_meta: {
							claudeCode: {
								toolName: 'Bash',
								toolResponse: { backgroundTaskId: 'shell-1' },
							},
						},
					},
				});
				await conn.sessionUpdate({
					sessionId: params.sessionId,
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: { type: 'text', text: 'waiting on the shell' },
					},
				});
				await sdkMessage(conn, params.sessionId, {
					type: 'system',
					subtype: 'session_state_changed',
					state: 'idle',
				});
				if (first.text === 'background-shell:finish') {
					finishShell(conn, params.sessionId);
				}
				if (first.text === 'background-shell:slow-finish') {
					finishShell(conn, params.sessionId, 600);
				}
				if (first.text === 'background-shell:exit') {
					setTimeout(() => process.exit(1), 100);
				}
				return { stopReason: 'end_turn' };
			}
			if (first?.type === 'text' && first.text === 'finish-shell') {
				finishShell(conn, params.sessionId);
				await conn.sessionUpdate({
					sessionId: params.sessionId,
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: { type: 'text', text: 'ok' },
					},
				});
				return { stopReason: 'end_turn' };
			}
			await conn.sessionUpdate({
				sessionId: params.sessionId,
				update: {
					sessionUpdate: 'agent_message_chunk',
					content: {
						type: 'text',
						text:
							models.length === 0
								? String(process.pid)
								: `${process.pid}:${sessionModels.get(params.sessionId) ?? models[0]}`,
					},
				},
			});
			return { stopReason: 'end_turn' };
		},
	}),
	ndJsonStream(output, Bun.stdin.stream()),
);
