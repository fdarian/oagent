import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SubagentDock } from './subagent-dock';
import { createConcurrentSubagentFixture } from './subagent-fixtures';

const meta: Meta<typeof SubagentDock> = {
	component: SubagentDock,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const OneRunningChild: Story = {
	args: (() => {
		const fixture = createConcurrentSubagentFixture(1);
		return {
			sessions: fixture.children,
			activeChildSessionId: undefined,
			onSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};

export const ThreeConcurrentChildren: Story = {
	args: (() => {
		const fixture = createConcurrentSubagentFixture(3);
		return {
			sessions: fixture.children,
			activeChildSessionId: 'child-2',
			onSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};

export const ManyChildrenOverflow: Story = {
	args: (() => {
		const fixture = createConcurrentSubagentFixture(10);
		return {
			sessions: fixture.children,
			activeChildSessionId: undefined,
			onSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};

export const LongActivity: Story = {
	args: (() => {
		const fixture = createConcurrentSubagentFixture(
			1,
			'Inspecting the authentication middleware, comparing error handling branches, and locating the best test fixture for the child timeline',
		);
		return {
			sessions: fixture.children,
			activeChildSessionId: undefined,
			onSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};
