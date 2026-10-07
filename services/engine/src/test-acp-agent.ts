/** Minimal ACP agent subprocess for tests; each prompt replies with its pid. */
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

new AgentSideConnection(
	(conn) => ({
		initialize: async () => ({
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities: {},
		}),
		newSession: async () => ({ sessionId: crypto.randomUUID() }),
		authenticate: async () => ({}),
		cancel: async () => {},
		prompt: async (params) => {
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
