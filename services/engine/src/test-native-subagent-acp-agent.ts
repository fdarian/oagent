/** Minimal ACP agent subprocess that reports native subagent sessions like claude-agent-acp. */
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

const supportsSubagents = (capabilities: unknown) =>
	typeof capabilities === 'object' &&
	capabilities !== null &&
	'subagents' in capabilities;

const state = { clientCapabilities: undefined as unknown };

new AgentSideConnection(
	(conn) => {
		const chunk = (sessionId: string, text: string) =>
			conn.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'text', text },
				},
			});
		// The adapter's frames are outside the SDK's schema, so they bypass the typed API.
		const raw = (sessionId: string, update: Record<string, unknown>) => {
			process.stdout.write(
				`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })}\n`,
			);
		};
		return {
			initialize: async (params) => {
				state.clientCapabilities = params.clientCapabilities;
				return {
					protocolVersion: PROTOCOL_VERSION,
					agentCapabilities: {},
				};
			},
			newSession: async () => ({ sessionId: 'root' }),
			authenticate: async () => ({}),
			cancel: async () => {},
			prompt: async (params) => {
				const text = params.prompt.map((block) =>
					block.type === 'text' ? block.text : '',
				);
				if (text.join('') === 'permission') {
					const response = await conn.requestPermission({
						sessionId: 'child',
						toolCall: { toolCallId: 'tool-1' },
						options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
					});
					await chunk('root', JSON.stringify(response.outcome));
					return { stopReason: 'end_turn' };
				}
				await chunk('root', JSON.stringify(state.clientCapabilities));
				if (!supportsSubagents(state.clientCapabilities)) {
					return { stopReason: 'end_turn' };
				}
				raw('root', {
					sessionUpdate: 'subagent_spawned',
					subagentSessionId: 'child',
					name: 'Explore repo',
					task: 'look around',
					capabilities: {},
				});
				await conn.sessionUpdate({
					sessionId: 'child',
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: { type: 'text', text: 'child text' },
						_meta: { claudeCode: { parentToolUseId: 'toolu_1' } },
					},
				});
				raw('child', {
					sessionUpdate: 'subagent_spawned',
					subagentSessionId: 'grandchild',
					name: 'Nested',
					task: 'deeper',
					capabilities: {},
				});
				await chunk('grandchild', 'grandchild text');
				await chunk('stray', 'nobody listens');
				raw('child', {
					sessionUpdate: 'subagent_state_update',
					subagentSessionId: 'grandchild',
					state: 'completed',
				});
				raw('root', {
					sessionUpdate: 'subagent_state_update',
					subagentSessionId: 'child',
					state: 'failed',
				});
				return { stopReason: 'end_turn' };
			},
		};
	},
	ndJsonStream(output, Bun.stdin.stream()),
);
