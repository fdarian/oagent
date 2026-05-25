import type { Meta, StoryObj } from '@storybook/react-vite';
import { JobHeader } from './job-header';

const meta: Meta<typeof JobHeader> = {
	component: JobHeader,
};

export default meta;
type Story = StoryObj<typeof meta>;

const base = {
	id: '550e8400-e29b-41d4-a716-446655440000',
	prompt:
		'Refactor the authentication middleware to use Effect.ts\nAdd proper error handling for all edge cases',
	cwd: '/Users/dev/project/apps/api',
	model: 'opencode-go/kimi-k2.6',
	createdAt: Date.now() - 120_000,
};

export const Running: Story = {
	args: {
		...base,
		status: 'running',
		terminatedAt: undefined,
		onCancel: () => {},
	},
};

export const Completed: Story = {
	args: {
		...base,
		status: 'done',
		terminatedAt: Date.now() - 30_000,
		onCancel: undefined,
	},
};

export const Errored: Story = {
	args: {
		...base,
		status: 'error',
		terminatedAt: Date.now() - 15_000,
		onCancel: undefined,
	},
};
