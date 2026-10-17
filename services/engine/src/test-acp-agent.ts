/**
 * Minimal ACP agent subprocess for tests; each prompt replies with its pid.
 * A prompt with the text `wait-for-steer` stays in flight until a
 * `_session/steering` request arrives, then answers the steered text.
 * Set `TEST_ACP_NO_STEERING=1` to omit the steering capability.
 *
 * A prompt starting with `background-shell` mimics Claude launching a background
 * shell: it reports the task through `_claude/sdkMessage`, answers "waiting" and
 * ends the turn. `background-shell:finish` then ends the shell 100ms later and
 * runs an autonomous follow-up cycle answering "shell finished"; plain
 * `background-shell` never finishes.
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

const sdkMessage = (
	conn: AgentSideConnection,
	sessionId: string,
	message: Record<string, unknown>,
) => conn.extNotification('_claude/sdkMessage', { sessionId, message });

const inFlight = new Map<string, (steeredText: string) => Promise<void>>();
const cancelInFlight = new Map<string, () => void>();

new AgentSideConnection(
	(conn) => ({
		initialize: async () => ({
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities: {},
			...(process.env.TEST_ACP_NO_STEERING === '1'
				? {}
				: { _meta: { steering: { supported: true } } }),
		}),
		newSession: async () => ({ sessionId: crypto.randomUUID() }),
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
					subtype: 'background_tasks_changed',
					tasks: [{ task_id: 'shell-1', task_type: 'local_bash' }],
				});
				await conn.sessionUpdate({
					sessionId: params.sessionId,
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: { type: 'text', text: 'waiting on the shell' },
					},
				});
				if (first.text === 'background-shell:finish') {
					setTimeout(async () => {
						await sdkMessage(conn, params.sessionId, {
							type: 'system',
							subtype: 'background_tasks_changed',
							tasks: [],
						});
						await sdkMessage(conn, params.sessionId, {
							type: 'system',
							subtype: 'session_state_changed',
							state: 'running',
						});
						await conn.sessionUpdate({
							sessionId: params.sessionId,
							update: {
								sessionUpdate: 'agent_message_chunk',
								content: { type: 'text', text: 'shell finished' },
							},
						});
						await sdkMessage(conn, params.sessionId, {
							type: 'system',
							subtype: 'session_state_changed',
							state: 'idle',
						});
					}, 100);
				}
				return { stopReason: 'end_turn' };
			}
			await conn.sessionUpdate({
				sessionId: params.sessionId,
				update: {
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'text', text: String(process.pid) },
				},
			});
			return { stopReason: 'end_turn' };
		},
	}),
	ndJsonStream(output, Bun.stdin.stream()),
);
