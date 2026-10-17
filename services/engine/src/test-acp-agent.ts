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
