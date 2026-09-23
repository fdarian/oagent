import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChildTimeline } from '@/lib/event-adapter';
import { getRunningSubagentSessions, SubagentDock } from './subagent-dock';

function childSession(
	id: string,
	parentId: string,
	status: ChildTimeline['status'],
): ChildTimeline {
	return {
		id,
		parentId,
		depth: 1,
		title: id,
		parts: [],
		streamingTail: null,
		status,
		startedAt: 0,
		lastActivity: id,
	};
}

describe('SubagentDock timeline scope', () => {
	test('shows only running sessions nested under the viewed child', () => {
		const sessions = new Map([
			['root-child', childSession('root-child', 'root-session', 'running')],
			['nested-child', childSession('nested-child', 'viewed-child', 'running')],
			[
				'completed-child',
				childSession('completed-child', 'viewed-child', 'completed'),
			],
			[
				'unrelated-child',
				childSession('unrelated-child', 'other-parent', 'running'),
			],
		]);
		const markup = renderToStaticMarkup(
			<SubagentDock
				sessions={sessions}
				scopeSessionId="viewed-child"
				activeChildSessionId={undefined}
				onSelect={() => {}}
			/>,
		);

		expect(markup).toContain('1 running agent');
		expect(
			getRunningSubagentSessions(sessions, 'viewed-child').map(
				(child) => child.id,
			),
		).toEqual(['nested-child']);
	});

	test('renders nothing when the viewed child has no running nested sessions', () => {
		const sessions = new Map([
			['root-child', childSession('root-child', 'root-session', 'running')],
		]);
		const markup = renderToStaticMarkup(
			<SubagentDock
				sessions={sessions}
				scopeSessionId="viewed-child"
				activeChildSessionId={undefined}
				onSelect={() => {}}
			/>,
		);

		expect(markup).toBe('');
	});

	test('keeps all running sessions in the top-level job view', () => {
		const sessions = new Map([
			['root-child', childSession('root-child', 'root-session', 'running')],
			['nested-child', childSession('nested-child', 'viewed-child', 'running')],
		]);
		const markup = renderToStaticMarkup(
			<SubagentDock
				sessions={sessions}
				activeChildSessionId={undefined}
				onSelect={() => {}}
			/>,
		);

		expect(markup).toContain('2 running agents');
		expect(
			getRunningSubagentSessions(sessions, undefined).map((child) => child.id),
		).toEqual(['root-child', 'nested-child']);
	});
});
