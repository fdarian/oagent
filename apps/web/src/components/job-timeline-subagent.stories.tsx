import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { JobTimelineSubagent } from './job-timeline-subagent';
import {
	createPendingSubagentFixture,
	createSubagentFixture,
	longSubagentDescription,
} from './subagent-fixtures';

const meta: Meta<typeof JobTimelineSubagent> = {
	component: JobTimelineSubagent,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'running-child',
			status: 'running',
			title: 'Say hi',
			description: 'Say hi',
			agentName: 'general',
		});
		return {
			part: fixture.parent,
			child: fixture.child,
			onSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};

export const Completed: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'completed-child',
			status: 'completed',
			title: 'Say hi',
			description: 'Say hi',
			agentName: 'general',
		});
		return {
			part: fixture.parent,
			child: fixture.child,
			onSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};

export const Failed: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'failed-child',
			status: 'failed',
			title: 'Run the integration checks',
			agentName: 'general',
		});
		return {
			part: fixture.parent,
			child: fixture.child,
			onSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};

export const Pending: Story = {
	args: {
		part: createPendingSubagentFixture().parent,
		child: undefined,
		onSelect: fn<(sessionId: string) => void>(),
	},
};

export const LegacyTask: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'legacy-child',
			status: 'completed',
			legacy: true,
			title: 'Explore the legacy task shape',
			agentName: 'explore',
		});
		return {
			part: fixture.parent,
			child: fixture.child,
			onSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};

export const LongDescription: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'long-description-child',
			status: 'running',
			title: longSubagentDescription,
			description: longSubagentDescription,
			agentName: 'general',
		});
		return {
			part: fixture.parent,
			child: fixture.child,
			onSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};
