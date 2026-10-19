import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { foldTimeline } from './timeline.ts';

const agent = (text: string): SessionUpdate => ({
	sessionUpdate: 'agent_message_chunk',
	content: { type: 'text', text },
});

const steer = (text: string): SessionUpdate => ({
	sessionUpdate: 'user_message_chunk',
	content: { type: 'text', text },
	_meta: { 'oagent/steer': true },
});

describe('foldTimeline', () => {
	test('merges adjacent assistant chunks and splits them around other entries', () => {
		expect(
			foldTimeline([
				agent('Hel'),
				agent('lo'),
				{ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run' },
				agent('Bye'),
			]),
		).toEqual([
			{ type: 'assistant', text: 'Hello' },
			{ type: 'tool', title: 'Run', kind: null, status: null },
			{ type: 'assistant', text: 'Bye' },
		]);
	});

	test('dropped events do not break adjacency', () => {
		expect(
			foldTimeline([
				agent('a'),
				{
					sessionUpdate: 'agent_thought_chunk',
					content: { type: 'text', text: 'thinking' },
				},
				{ sessionUpdate: 'usage_update', size: 10, used: 1 },
				agent('b'),
			]),
		).toEqual([{ type: 'assistant', text: 'ab' }]);
	});

	test('keeps only steer user chunks and merges adjacent ones', () => {
		expect(
			foldTimeline([
				{
					sessionUpdate: 'user_message_chunk',
					content: { type: 'text', text: 'initial prompt echo' },
				},
				steer('go '),
				steer('left'),
				agent('ok'),
				steer('now right'),
				{
					sessionUpdate: 'user_message_chunk',
					content: { type: 'text', text: 'flag false' },
					_meta: { 'oagent/steer': false },
				},
			]),
		).toEqual([
			{ type: 'user', text: 'go left' },
			{ type: 'assistant', text: 'ok' },
			{ type: 'user', text: 'now right' },
		]);
	});

	test('folds tool call updates into one entry at first appearance', () => {
		expect(
			foldTimeline([
				{
					sessionUpdate: 'tool_call',
					toolCallId: 'a',
					title: 'Read file',
					kind: 'read',
					status: 'pending',
				},
				agent('between'),
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: 'a',
					status: 'in_progress',
					title: null,
				},
				{
					sessionUpdate: 'tool_call',
					toolCallId: 'b',
					title: 'Edit',
					kind: 'edit',
				},
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: 'a',
					status: 'completed',
					kind: null,
				},
			]),
		).toEqual([
			{ type: 'tool', title: 'Read file', kind: 'read', status: 'completed' },
			{ type: 'assistant', text: 'between' },
			{ type: 'tool', title: 'Edit', kind: 'edit', status: null },
		]);
	});

	test('an update arriving without a prior tool_call creates the entry', () => {
		expect(
			foldTimeline([
				{ sessionUpdate: 'tool_call_update', toolCallId: 'x', status: 'failed' },
			]),
		).toEqual([{ type: 'tool', title: null, kind: null, status: 'failed' }]);
	});

	test('a plan directly after a plan replaces it', () => {
		const first = [
			{ content: 'one', priority: 'medium', status: 'pending' },
		] as const;
		const second = [
			{ content: 'one', priority: 'medium', status: 'completed' },
		] as const;
		expect(
			foldTimeline([
				{ sessionUpdate: 'plan', entries: [...first] },
				{ sessionUpdate: 'plan', entries: [...second] },
				agent('x'),
				{ sessionUpdate: 'plan', entries: [...first] },
			]),
		).toEqual([
			{ type: 'plan', entries: [...second] },
			{ type: 'assistant', text: 'x' },
			{ type: 'plan', entries: [...first] },
		]);
	});

	test('emits notices and drops unrelated update types', () => {
		const dropped: SessionUpdate[] = [
			{ sessionUpdate: 'available_commands_update', availableCommands: [] },
			{ sessionUpdate: 'current_mode_update', currentModeId: 'm' },
			{ sessionUpdate: 'session_info_update', title: 't' },
			{ sessionUpdate: 'plan_removed', planId: 'p' },
			{
				sessionUpdate: 'compaction_update',
				compactionId: 'c',
				status: 'started',
			},
			{
				sessionUpdate: 'compaction_summary_chunk',
				compactionId: 'c',
				content: { type: 'text', text: 'summary' },
			},
			{ sessionUpdate: 'subagent_update', sessionId: 's' },
			{
				sessionUpdate: 'session_message',
				messageId: 'm',
				content: [{ type: 'text', text: 'hi' }],
			},
			{
				sessionUpdate: 'session_message_chunk',
				messageId: 'm',
				content: { type: 'text', text: 'hi' },
			},
			{ sessionUpdate: 'cursor_extension' } as unknown as SessionUpdate,
		];
		expect(
			foldTimeline([
				...dropped,
				{ sessionUpdate: 'notice', severity: 'warning', title: 'Careful' },
			]),
		).toEqual([{ type: 'notice', severity: 'warning', title: 'Careful' }]);
	});

	test('renders non-text blocks as placeholders', () => {
		expect(
			foldTimeline([
				agent('see '),
				{
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'image', data: 'AAAA', mimeType: 'image/png' },
				},
				{
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'resource_link', name: 'f', uri: 'file:///f' },
				},
				{
					sessionUpdate: 'agent_message_chunk',
					content: {
						type: 'resource',
						resource: { uri: 'file:///f', text: 'body' },
					},
				},
				{
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' },
				},
			]),
		).toEqual([
			{
				type: 'assistant',
				text: 'see [image][resource_link][resource][audio]',
			},
		]);
	});

	test('empty text chunks produce no entry', () => {
		expect(foldTimeline([agent(''), steer('')])).toEqual([]);
	});
});
