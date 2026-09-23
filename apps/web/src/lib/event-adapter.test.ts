import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@oagent/engine';
import {
	applyEvent,
	createInitialState,
	finalizeState,
	reduceTimedEvents,
	type TimelinePart,
	toDisplayState,
} from './event-adapter';
import { stripChildTitlePrefix } from './subagent-title';

function childMeta(
	id: string,
	parentId: string,
	depth: number,
	title: string,
): Record<string, unknown> {
	return {
		'opencode/child-session': { id, parentID: parentId, depth, title },
	};
}

function toolPartAt(parts: TimelinePart[], index: number) {
	const part = parts[index];
	if (part === undefined || part.kind !== 'tool') {
		throw new Error(`Expected tool part at index ${index}`);
	}
	return part;
}

describe('event adapter steer messages', () => {
	test('shows a steer message while it is streaming', () => {
		const event = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'steer-1',
			content: { type: 'text', text: 'Please add a test.' },
			_meta: { 'oagent/steer': true },
		} satisfies SessionUpdate;
		const state = applyEvent(createInitialState(), event, 1000);

		expect(toDisplayState(state).streamingTail).toEqual({
			kind: 'steer',
			id: 'steer-0',
			text: 'Please add a test.',
			createdAt: 1000,
		});
	});

	test('combines chunks from the same steer message', () => {
		const firstEvent = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'steer-1',
			content: { type: 'text', text: 'Please add ' },
			_meta: { 'oagent/steer': true },
		} satisfies SessionUpdate;
		const secondEvent = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'steer-1',
			content: { type: 'text', text: 'a test.' },
			_meta: { 'oagent/steer': true },
		} satisfies SessionUpdate;
		const firstState = applyEvent(createInitialState(), firstEvent, 1000);
		const secondState = applyEvent(firstState, secondEvent, 1100);

		expect(finalizeState(secondState, 1200).parts).toEqual([
			{
				kind: 'steer',
				id: 'steer-0',
				text: 'Please add a test.',
				createdAt: 1000,
			},
		]);
	});

	test('keeps separate steer messages separate', () => {
		const firstEvent = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'steer-1',
			content: { type: 'text', text: 'First message' },
			_meta: { 'oagent/steer': true },
		} satisfies SessionUpdate;
		const secondEvent = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'steer-2',
			content: { type: 'text', text: 'Second message' },
			_meta: { 'oagent/steer': true },
		} satisfies SessionUpdate;
		const firstState = applyEvent(createInitialState(), firstEvent, 1000);
		const secondState = applyEvent(firstState, secondEvent, 1100);

		expect(finalizeState(secondState, 1200).parts).toEqual([
			{
				kind: 'steer',
				id: 'steer-0',
				text: 'First message',
				createdAt: 1000,
			},
			{
				kind: 'steer',
				id: 'steer-1',
				text: 'Second message',
				createdAt: 1100,
			},
		]);
	});

	test('ignores user message chunks that are not steers', () => {
		const event = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'prompt-1',
			content: { type: 'text', text: 'Initial prompt' },
		} satisfies SessionUpdate;
		const state = applyEvent(createInitialState(), event, 1000);

		expect(finalizeState(state, 1100).parts).toEqual([]);
	});
});

describe('historical event reduction', () => {
	test('finalizes reasoning at the persisted turn termination time', () => {
		const event = {
			sessionUpdate: 'agent_thought_chunk',
			messageId: 'thought-1',
			content: { type: 'text', text: 'Thinking' },
		} satisfies SessionUpdate;

		const result = reduceTimedEvents([{ event, createdAt: 1000 }], 1750);

		expect(result.parts).toEqual([
			{
				kind: 'reasoning',
				id: 'reasoning-0',
				text: 'Thinking',
				isStreaming: false,
				createdAt: 1000,
				durationMs: 750,
			},
		]);
	});
});

describe('subagent event timelines', () => {
	test('routes child events away from the parent and links the live call', () => {
		let state = createInitialState();
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'parent-call',
				title: 'subagent',
				kind: 'think',
				status: 'in_progress',
				rawInput: {
					agent: 'explore',
					description: 'Inspect the event model',
					prompt: 'Inspect events',
				},
			} as SessionUpdate,
			1000,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'agent_thought_chunk',
				messageId: 'thought-1',
				content: { type: 'text', text: 'Looking through the event adapter' },
				_meta: childMeta(
					'child-1',
					'root-session',
					1,
					'Inspect the event model',
				),
			} as SessionUpdate,
			1010,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'child-1:read-call',
				title: 'Read event-adapter.ts',
				kind: 'read',
				status: 'completed',
				_meta: childMeta(
					'child-1',
					'root-session',
					1,
					'Inspect the event model',
				),
			} as SessionUpdate,
			4020,
		);

		const live = toDisplayState(state);
		expect(live.parts).toHaveLength(1);
		expect(toolPartAt(live.parts, 0).childSessionId).toBe('child-1');
		const liveChild = live.children.get('child-1');
		if (liveChild === undefined) throw new Error('Missing child timeline');
		expect(liveChild.parts).toHaveLength(2);
		expect(toolPartAt(liveChild.parts, 1).toolCallId).toBe('child-1:read-call');
		expect(liveChild.status).toBe('running');
		expect(liveChild.agentName).toBe('explore');
		expect(liveChild.lastActivity).toBe('Read event-adapter.ts');

		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 'parent-call',
				title: 'subagent',
				status: 'completed',
				rawOutput: { metadata: { sessionID: 'child-1' } },
			} as SessionUpdate,
			5040,
		);

		const completed = toDisplayState(state);
		const completedChild = completed.children.get('child-1');
		if (completedChild === undefined) throw new Error('Missing child timeline');
		expect(completedChild.status).toBe('completed');
		expect(completedChild.startedAt).toBe(1010);
		expect(completedChild.endedAt).toBe(4020);
		expect(toolPartAt(completed.parts, 0).childSessionId).toBe('child-1');
	});

	test('falls back to parent tool duration when child event bounds have no range', () => {
		let state = createInitialState();
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'parent-call',
				title: 'subagent',
				status: 'in_progress',
				rawInput: { agent: 'general', description: 'One event child' },
			} as SessionUpdate,
			6000,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'Only child event' },
				_meta: childMeta(
					'one-event-child',
					'root-session',
					1,
					'One event child',
				),
			} as SessionUpdate,
			6500,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 'parent-call',
				status: 'completed',
				rawOutput: { metadata: { sessionID: 'one-event-child' } },
			} as SessionUpdate,
			9000,
		);

		const child = toDisplayState(state).children.get('one-event-child');
		if (child === undefined) throw new Error('Missing child timeline');
		expect(child.startedAt).toBe(6000);
		expect(child.endedAt).toBe(9000);
	});

	test('keeps background children running after their dispatch call completes', () => {
		let state = createInitialState();
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'background-call',
				title: 'subagent',
				status: 'in_progress',
				rawInput: {
					agent: 'general',
					description: 'Background child',
					background: true,
				},
			} as SessionUpdate,
			10_000,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'agent_thought_chunk',
				content: { type: 'text', text: 'Still working' },
				_meta: childMeta(
					'background-child',
					'root-session',
					1,
					'Background child',
				),
			} as SessionUpdate,
			10_500,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 'background-call',
				status: 'completed',
				rawOutput: { metadata: { sessionID: 'background-child' } },
			} as SessionUpdate,
			11_000,
		);

		const child = toDisplayState(state).children.get('background-child');
		if (child === undefined) throw new Error('Missing child timeline');
		expect(child.status).toBe('running');
		expect(child.endedAt).toBeUndefined();
	});

	test('scopes and normalizes running tool labels per timeline', () => {
		let state = createInitialState();
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'parent-call',
				title: 'subagent',
				status: 'in_progress',
				rawInput: {
					agent: 'general',
					description: 'Child task',
				},
			} as SessionUpdate,
			12_000,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'child:tool-call',
				title: 'Child task: sleep 10',
				kind: 'execute',
				status: 'in_progress',
				_meta: childMeta('child', 'root-session', 1, 'Child task'),
			} as SessionUpdate,
			12_500,
		);

		const display = toDisplayState(state);
		expect(display.lastStatus).toBe('Running tool: subagent');
		expect(display.children.get('child')?.lastStatus).toBe(
			'Running tool: sleep 10',
		);
		expect(stripChildTitlePrefix('Child task: sleep 10', 'Child task')).toBe(
			'sleep 10',
		);
	});

	test('replaces a description match with the authoritative legacy output id', () => {
		let state = createInitialState();
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'parent-call',
				title: 'subagent',
				status: 'in_progress',
				rawInput: {
					agent: 'general',
					description: 'Shared description',
				},
			} as SessionUpdate,
			2000,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'Provisional child' },
				_meta: childMeta(
					'child-provisional',
					'root-session',
					1,
					'Shared description',
				),
			} as SessionUpdate,
			2010,
		);
		expect(toolPartAt(toDisplayState(state).parts, 0).childSessionId).toBe(
			'child-provisional',
		);

		state = applyEvent(
			state,
			{
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'Authoritative child' },
				_meta: childMeta(
					'child-authoritative',
					'root-session',
					1,
					'Other title',
				),
			} as SessionUpdate,
			2020,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 'parent-call',
				status: 'failed',
				rawOutput: { metadata: { sessionId: 'child-authoritative' } },
			} as SessionUpdate,
			2030,
		);

		const display = toDisplayState(state);
		expect(toolPartAt(display.parts, 0).childSessionId).toBe(
			'child-authoritative',
		);
		expect(display.children.get('child-authoritative')?.status).toBe('failed');
	});

	test('links nested and resumed legacy calls to their child timelines', () => {
		let state = createInitialState();
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'outer-call',
				title: 'subagent',
				status: 'in_progress',
				rawInput: { agent: 'general', description: 'Outer work' },
			} as SessionUpdate,
			3000,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'outer-child:nested-call',
				title: 'task',
				status: 'in_progress',
				rawInput: {
					subagent_type: 'explore',
					description: 'Nested work',
					sessionID: 'nested-child',
				},
				_meta: childMeta('outer-child', 'root-session', 1, 'Outer work'),
			} as SessionUpdate,
			3010,
		);
		state = applyEvent(
			state,
			{
				sessionUpdate: 'agent_thought_chunk',
				content: { type: 'text', text: 'Working one level deeper' },
				_meta: childMeta('nested-child', 'outer-child', 2, 'Nested work'),
			} as SessionUpdate,
			3020,
		);

		const display = toDisplayState(state);
		const outer = display.children.get('outer-child');
		if (outer === undefined) throw new Error('Missing outer child timeline');
		expect(toolPartAt(outer.parts, 0).childSessionId).toBe('nested-child');
		const nested = display.children.get('nested-child');
		if (nested === undefined) throw new Error('Missing nested child timeline');
		expect(nested.parentId).toBe('outer-child');
		expect(nested.depth).toBe(2);
		expect(nested.agentName).toBe('explore');
		expect(nested.streamingTail?.kind).toBe('reasoning');

		const final = finalizeState(state);
		expect(final.children.get('outer-child')?.status).toBe('failed');
		expect(final.children.get('nested-child')?.status).toBe('failed');
	});
});
