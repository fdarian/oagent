import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { ChildTimeline } from '@/lib/event-adapter';
import {
	createNestedSubagentFixture,
	createSubagentFixture,
	longSubagentDescription,
} from './subagent-fixtures';
import { SubagentHeader } from './subagent-header';

const meta: Meta<typeof SubagentHeader> = {
	component: SubagentHeader,
};

export default meta;
type Story = StoryObj<typeof meta>;

function childAt(
	children: ReadonlyMap<string, ChildTimeline>,
	id: string,
): ChildTimeline {
	const child = children.get(id);
	if (child === undefined) throw new Error(`Missing fixture child: ${id}`);
	return child;
}

export const DepthOneRunning: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'header-running-child',
			status: 'running',
			title: 'Inspect the event model',
			agentName: 'explore',
		});
		if (fixture.child === undefined) throw new Error('Missing running child');
		return {
			child: fixture.child,
			sessions: fixture.display.children,
			onNavigate: fn<(sessionId: string | undefined) => void>(),
		};
	})(),
};

export const DepthOneCompleted: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'header-completed-child',
			status: 'completed',
			title: 'Summarize the implementation',
			agentName: 'general',
		});
		if (fixture.child === undefined) throw new Error('Missing completed child');
		return {
			child: fixture.child,
			sessions: fixture.display.children,
			onNavigate: fn<(sessionId: string | undefined) => void>(),
		};
	})(),
};

export const DepthTwoBreadcrumbs: Story = {
	args: (() => {
		const fixture = createNestedSubagentFixture();
		return {
			child: childAt(fixture.children, 'nested-child'),
			sessions: fixture.children,
			onNavigate: fn<(sessionId: string | undefined) => void>(),
		};
	})(),
};

export const LongDescription: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'header-long-child',
			status: 'running',
			title: longSubagentDescription,
			description: longSubagentDescription,
			agentName: 'general',
		});
		if (fixture.child === undefined)
			throw new Error('Missing long-description child');
		return {
			child: fixture.child,
			sessions: fixture.display.children,
			onNavigate: fn<(sessionId: string | undefined) => void>(),
		};
	})(),
};
