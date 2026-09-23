import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@oagent/engine';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	applyEvent,
	createInitialState,
	toDisplayState,
	type TimelinePart,
	type TimelineToolPart,
} from '@/lib/event-adapter';
import { JobTimelineSubagent } from './job-timeline-subagent';

function toolAt(parts: TimelinePart[], index: number): TimelineToolPart {
	const part = parts[index];
	if (part === undefined || part.kind !== 'tool') {
		throw new Error(`Expected tool part at index ${index}`);
	}
	return part;
}

describe('JobTimelineSubagent', () => {
	test.each(['completed', 'failed'] as const)(
		'renders a %s call as terminal while a later call to the same child is running',
		(terminalStatus) => {
			let state = createInitialState();
			state = applyEvent(
				state,
				{
					sessionUpdate: 'tool_call',
					toolCallId: 'first-call',
					title: 'subagent',
					status: 'in_progress',
					rawInput: { agent: 'general', description: 'First task' },
				} as SessionUpdate,
				1000,
			);
			state = applyEvent(
				state,
				{
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'text', text: 'Working' },
					_meta: {
						'opencode/child-session': {
							id: 'shared-child',
							parentID: 'root-session',
							depth: 1,
							title: 'First task',
						},
					},
				} as SessionUpdate,
				1100,
			);
			state = applyEvent(
				state,
				{
					sessionUpdate: 'tool_call_update',
					toolCallId: 'first-call',
					status: terminalStatus,
					rawOutput: { metadata: { sessionID: 'shared-child' } },
				} as SessionUpdate,
				2000,
			);
			state = applyEvent(
				state,
				{
					sessionUpdate: 'tool_call',
					toolCallId: 'second-call',
					title: 'subagent',
					status: 'in_progress',
					rawInput: {
						agent: 'general',
						description: 'Second task',
						sessionID: 'shared-child',
					},
				} as SessionUpdate,
				3000,
			);

			const display = toDisplayState(state);
			const child = display.children.get('shared-child');
			if (child === undefined) throw new Error('Missing shared child');
			const first = toolAt(display.parts, 0);
			const second = toolAt(display.parts, 1);
			expect(first.childSessionId).toBe(child.id);
			expect(second.childSessionId).toBe(child.id);
			expect(child.status).toBe('running');

			const firstMarkup = renderToStaticMarkup(
				<JobTimelineSubagent part={first} child={child} />,
			);
			const secondMarkup = renderToStaticMarkup(
				<JobTimelineSubagent part={second} child={child} />,
			);
			expect(firstMarkup).toContain('data-running="false"');
			expect(firstMarkup).toContain('data-component="task-tool-icon"');
			expect(secondMarkup).toContain('data-running="true"');
			expect(secondMarkup).toContain('data-component="task-tool-spinner"');
		},
	);
});
