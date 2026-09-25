import { describe, expect, test } from 'bun:test';
import { createOpenCodeEventTranslator } from './opencode-api-events.ts';

describe('OpenCode v2.0.16 event translation', () => {
	test('text and reasoning deltas become ACP chunks', () => {
		const translate = createOpenCodeEventTranslator();
		expect(
			translate({
				type: 'session.text.delta',
				data: {
					sessionID: 'ses_1',
					assistantMessageID: 'msg_1',
					ordinal: 0,
					delta: 'hello',
				},
			}),
		).toEqual([
			{
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'hello' },
			},
		]);
		expect(
			translate({
				type: 'session.reasoning.delta',
				data: {
					sessionID: 'ses_1',
					assistantMessageID: 'msg_1',
					ordinal: 1,
					delta: 'thinking',
				},
			}),
		).toEqual([
			{
				sessionUpdate: 'agent_thought_chunk',
				content: { type: 'text', text: 'thinking' },
			},
		]);
	});

	test('tool input, progress and terminal events retain call identity', () => {
		const translate = createOpenCodeEventTranslator();
		expect(
			translate({
				type: 'session.tool.input.started',
				data: {
					sessionID: 'ses_1',
					assistantMessageID: 'msg_1',
					id: 'call_1',
					name: 'bash',
				},
			}),
		).toEqual([]);
		translate({
			type: 'session.tool.input.delta',
			data: { id: 'call_1', delta: '{"command":' },
		});
		translate({
			type: 'session.tool.input.ended',
			data: { id: 'call_1', text: '{"command":"pwd"}' },
		});
		expect(
			translate({
				type: 'session.tool.called',
				data: { id: 'call_1', input: { command: 'pwd' }, executed: true },
			}),
		).toEqual([
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'call_1',
				title: 'bash',
				kind: 'execute',
				status: 'pending',
				rawInput: { command: 'pwd' },
			},
		]);
		expect(
			translate({
				type: 'session.tool.progress',
				data: { id: 'call_1', metadata: {} },
			}),
		).toEqual([
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 'call_1',
				title: 'bash',
				kind: 'execute',
				status: 'in_progress',
				rawInput: '{"command":"pwd"}',
			},
		]);
		expect(
			translate({
				type: 'session.tool.success',
				data: {
					id: 'call_1',
					content: [{ type: 'text', text: '/work' }],
					executed: true,
				},
			}),
		).toEqual([
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 'call_1',
				title: 'bash',
				kind: 'execute',
				status: 'completed',
				rawInput: '{"command":"pwd"}',
				rawOutput: '/work',
			},
		]);
	});

	test('failed tools and unknown events', () => {
		const translate = createOpenCodeEventTranslator();
		translate({
			type: 'session.tool.input.started',
			data: { id: 'call_2', name: 'read' },
		});
		translate({
			type: 'session.tool.called',
			data: { id: 'call_2', input: { path: 'missing' } },
		});
		expect(
			translate({
				type: 'session.tool.failed',
				data: {
					id: 'call_2',
					error: { type: 'ToolError', message: 'not found' },
				},
			}),
		).toEqual([
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 'call_2',
				title: 'read',
				kind: 'other',
				status: 'failed',
				rawInput: '',
				rawOutput: 'not found',
			},
		]);
		expect(translate({ type: 'session.unrecognized', data: {} })).toEqual([]);
	});
});
