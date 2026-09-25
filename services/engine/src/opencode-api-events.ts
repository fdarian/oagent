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
			if (typeof data.name !== 'string') return [];
			const title = data.name;
			const kind = /^(bash|shell|execute|terminal)$/.test(title)
				? ('execute' as const)
				: ('other' as const);
			tools.set(id, { title, kind, input: '' });
			return [
				{
					sessionUpdate: 'tool_call',
					toolCallId: id,
					title,
					kind,
					status: 'pending',
					rawInput: '',
				},
			];
		}
		const tool = tools.get(id);
		if (tool === undefined) return [];
		if (
			event.type === 'session.tool.input.delta' &&
			typeof data.delta === 'string'
		) {
			tool.input += data.delta;
			return [
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: id,
					rawInput: tool.input,
					status: 'pending',
				},
			];
		}
		if (
			event.type === 'session.tool.input.ended' &&
			typeof data.text === 'string'
		) {
			tool.input = data.text;
			return [
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: id,
					rawInput: tool.input,
					status: 'pending',
				},
			];
		}
		if (event.type === 'session.tool.called') {
			return [
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: id,
					title: tool.title,
					kind: tool.kind,
					status: 'in_progress',
					rawInput: data.input,
				},
			];
		}
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
