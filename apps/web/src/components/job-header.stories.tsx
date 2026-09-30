import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { JobHeader } from './job-header';

const meta: Meta<typeof JobHeader> = {
	component: JobHeader,
};

export default meta;
type Story = StoryObj<typeof meta>;

const base = {
	id: '550e8400-e29b-41d4-a716-446655440000',
	title: 'Refactor authentication middleware',
	cwd: '/Users/dev/project/apps/api',
	backend: 'opencode' as const,
	model: 'opencode-go/kimi-k2.6',
	sessionId: '01a0d126-0000-7000-8000-000000000001',
	harnessSessionId: 'ses_01JSESSIONEXAMPLE1234567890',
	createdAt: Date.now() - 120_000,
};

export const Running: Story = {
	args: {
		...base,
		status: 'running',
		terminatedAt: undefined,
		onCancel: () => {},
		onNewSideChat: fn(),
	},
};

export const Completed: Story = {
	args: {
		...base,
		status: 'done',
		terminatedAt: Date.now() - 30_000,
		onCancel: undefined,
		onNewSideChat: fn(),
	},
};

export const WithSideChats: Story = {
	args: {
		...base,
		status: 'done',
		terminatedAt: Date.now() - 30_000,
		onCancel: undefined,
		onNewSideChat: fn(),
		onOpenSideChats: fn(),
	},
};

export const Errored: Story = {
	args: {
		...base,
		status: 'error',
		terminatedAt: Date.now() - 15_000,
		onCancel: undefined,
		onNewSideChat: fn(),
	},
};

const cost = {
	status: 'ready' as const,
	inputTokens: 12345,
	outputTokens: 6789,
	cacheCreationTokens: 2000,
	cacheReadTokens: 123456,
	totalCostUsd: 1.23,
	computedAt: Date.now(),
	stale: false,
};

export const WithCost: Story = {
	args: { ...Completed.args, cost },
};

export const StaleCost: Story = {
	args: { ...Running.args, cost: { ...cost, stale: true } },
};

export const LoadingCost: Story = {
	args: { ...Completed.args, costLoading: true },
};

export const CostError: Story = {
	args: {
		...Completed.args,
		costError: 'No Codex session found with ID: missing-session',
	},
};

export const UnsupportedCost: Story = {
	args: { ...Completed.args, backend: 'grok', cost: { status: 'unsupported' } },
};
