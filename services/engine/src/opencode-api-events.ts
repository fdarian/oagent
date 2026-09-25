import type { SessionUpdate } from '@agentclientprotocol/sdk';

type Event = { type: string; data: Record<string, unknown> };
type Tool = { title: string; kind: 'execute' | 'other'; input: string };

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function output(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (!Array.isArray(value)) return undefined;
	return value
		.flatMap((part) => {
			const entry = record(part);
			return entry?.type === 'text' && typeof entry.text === 'string'
				? [entry.text]
				: [];
		})
		.join('\n');
}

/** State is confined to one turn; OpenCode input deltas precede the parsed tool call. */
export function createOpenCodeEventTranslator() {
	const tools = new Map<string, Tool>();
	const inputs = new Map<string, string>();
	const names = new Map<string, string>();
	return (event: Event): SessionUpdate[] => {
		const data = event.data;
		if (
			(event.type === 'session.text.delta' ||
				event.type === 'session.reasoning.delta') &&
			typeof data.delta === 'string'
		) {
			return [
				{
					sessionUpdate:
						event.type === 'session.text.delta'
							? 'agent_message_chunk'
							: 'agent_thought_chunk',
					content: { type: 'text', text: data.delta },
				},
			];
		}
		if (typeof data.id !== 'string') return [];
		const id = data.id;
		if (event.type === 'session.tool.input.started') {
			inputs.set(id, '');
			if (typeof data.name === 'string') names.set(id, data.name);
			return [];
		}
		if (
			event.type === 'session.tool.input.delta' &&
			typeof data.delta === 'string'
		) {
			inputs.set(
				id,
				`${inputs.get(id) === undefined ? '' : inputs.get(id)}${data.delta}`,
			);
			return [];
		}
		if (
			event.type === 'session.tool.input.ended' &&
			typeof data.text === 'string'
		) {
			inputs.set(id, data.text);
			return [];
		}
		if (event.type === 'session.tool.called') {
			const title = names.get(id);
			if (title === undefined) return [];
			const kind = /^(bash|shell|execute|terminal)$/.test(title)
				? ('execute' as const)
				: ('other' as const);
			const input = inputs.get(id);
			tools.set(id, {
				title,
				kind,
				input: input === undefined ? JSON.stringify(data.input) : input,
			});
			return [
				{
					sessionUpdate: 'tool_call',
					toolCallId: id,
					title,
					kind,
					status: 'pending',
					rawInput: data.input,
				},
			];
		}
		const tool = tools.get(id);
		if (tool === undefined) return [];
		if (event.type === 'session.tool.progress') {
			return [
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: id,
					status: 'in_progress',
					title: tool.title,
					kind: tool.kind,
					rawInput: tool.input,
				},
			];
		}
		if (
			event.type === 'session.tool.success' ||
			event.type === 'session.tool.failed'
		) {
			tools.delete(id);
			inputs.delete(id);
			names.delete(id);
			return [
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: id,
					status:
						event.type === 'session.tool.success' ? 'completed' : 'failed',
					title: tool.title,
					kind: tool.kind,
					rawInput: tool.input,
					rawOutput:
						event.type === 'session.tool.failed'
							? record(data.error)?.message
							: output(data.content),
				},
			];
		}
		return [];
	};
}
