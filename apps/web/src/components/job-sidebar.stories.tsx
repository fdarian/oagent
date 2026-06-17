import type { Meta, StoryObj } from '@storybook/react-vite';
import { JobSidebar } from './job-sidebar';

const meta: Meta<typeof JobSidebar> = {
	component: JobSidebar,
	parameters: {
		layout: 'fullscreen',
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
	args: {
		grouped: [],
		jobs: [],
		selectedId: undefined,
		isLoading: false,
		cwdFilter: '',
		onCwdFilterChange: () => {},
	},
};

const denseItems = Array.from({ length: 12 }).map((_, i) => ({
	id: `job-${i}`,
	status: i % 3 === 0 ? 'running' : i % 3 === 1 ? 'done' : 'error',
	createdAt: Date.now() - i * 60_000,
	prompt: `Task ${i}: analyze codebase`,
	cwd: '/Users/dev/project',
	model: 'opencode-go/kimi-k2.6',
	mcpSessionId: i % 2 === 0 ? 'session-abc-123' : undefined,
}));

export const Dense: Story = {
	args: {
		grouped: [{ label: 'TODAY', items: denseItems }],
		jobs: denseItems,
		selectedId: 'job-2',
		isLoading: false,
		cwdFilter: '',
		onCwdFilterChange: () => {},
	},
};

const mixedItems = [
	{
		id: 'job-a',
		status: 'running',
		createdAt: Date.now() - 30_000,
		prompt: 'Refactor auth middleware',
		cwd: '/Users/dev/app',
		model: 'opencode-go/kimi-k2.6',
		mcpSessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
	},
	{
		id: 'job-b',
		status: 'done',
		createdAt: Date.now() - 300_000,
		prompt: 'List files in src/',
		cwd: '/Users/dev/app',
		mcpSessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
	},
	{
		id: 'job-c',
		status: 'error',
		createdAt: Date.now() - 600_000,
		prompt: 'Deploy to production',
		cwd: '/Users/dev/infra',
	},
	{
		id: 'job-d',
		status: 'done',
		createdAt: Date.now() - 86_400_000,
		prompt: 'Write tests for utils',
		cwd: '/Users/dev/app',
		mcpSessionId: 'f9e8d7c6-b5a4-3210-fedc-ba9876543210',
	},
];

export const MixedStatuses: Story = {
	args: {
		grouped: [
			{
				label: 'TODAY',
				items: mixedItems.slice(0, 3),
			},
			{
				label: 'YESTERDAY',
				items: mixedItems.slice(3),
			},
		],
		jobs: mixedItems,
		selectedId: 'job-a',
		isLoading: false,
		cwdFilter: '',
		onCwdFilterChange: () => {},
	},
};

const longItem = {
	id: 'job-long',
	status: 'running',
	createdAt: Date.now() - 10_000,
	prompt:
		'This is an extremely long prompt that goes on and on describing in great detail exactly what needs to be done across multiple lines and paragraphs so that we can verify truncation behavior in the sidebar row component',
	cwd: '/Users/dev/very/long/path/to/the/project/directory',
};

export const LongTitles: Story = {
	args: {
		grouped: [{ label: 'TODAY', items: [longItem] }],
		jobs: [longItem],
		selectedId: 'job-long',
		isLoading: false,
		cwdFilter: '',
		onCwdFilterChange: () => {},
	},
};
