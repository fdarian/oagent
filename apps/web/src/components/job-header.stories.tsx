import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
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

export const SwitchModel: Story = {
	args: { ...base, status: 'running' },
	render: function Render(args) {
		const [model, setModel] = useState(base.model);
		return (
			<JobHeader
				{...args}
				sessionModelControl={{
					model,
					models: [
						{ id: base.model, label: 'Kimi K2.6' },
						{ id: 'provider/next-model', label: 'Next model' },
					],
					onChange: setModel,
					isPending: false,
				}}
			/>
		);
	},
	play: async (context) => {
		const canvas = within(context.canvasElement);
		await userEvent.click(
			canvas.getByRole('combobox', { name: 'Session model' }),
		);
		await userEvent.click(
			await within(context.canvasElement.ownerDocument.body).findByRole(
				'option',
				{
					name: 'Next model',
				},
			),
		);
		await expect(
			canvas.getByRole('combobox', { name: 'Session model' }),
		).toHaveTextContent('provider/next-model');
	},
};

export const UnsupportedModelSwitch: Story = {
	args: { ...base, backend: 'grok', status: 'done', model: 'grok-4' },
	play: async (context) => {
		const canvas = within(context.canvasElement);
		await expect(
			canvas.queryByRole('combobox', { name: 'Session model' }),
		).not.toBeInTheDocument();
		await expect(canvas.getByText('grok-4')).toBeVisible();
	},
};

export const ModelsNotReady: Story = {
	args: { ...base, status: 'done', model: 'provider/next-model' },
	play: async (context) => {
		const canvas = within(context.canvasElement);
		await expect(
			canvas.queryByRole('combobox', { name: 'Session model' }),
		).not.toBeInTheDocument();
		await expect(canvas.getByText('provider/next-model')).toBeVisible();
	},
};

export const ModelChangePending: Story = {
	args: {
		...base,
		status: 'running',
		sessionModelControl: {
			model: base.model,
			models: [{ id: base.model, label: 'Kimi K2.6' }],
			onChange: fn(),
			isPending: true,
		},
	},
	play: async (context) => {
		await expect(
			within(context.canvasElement).getByRole('combobox', {
				name: 'Session model',
			}),
		).toBeDisabled();
	},
};

export const ModelChangeError: Story = {
	args: {
		...base,
		status: 'done',
		sessionModelControl: {
			model: base.model,
			models: [{ id: base.model, label: 'Kimi K2.6' }],
			onChange: fn(),
			isPending: false,
			error: 'Could not persist the session model.',
		},
	},
	play: async (context) => {
		const canvas = within(context.canvasElement);
		await expect(
			canvas.getByRole('combobox', { name: 'Session model' }),
		).toBeEnabled();
		await expect(canvas.getByRole('alert')).toHaveTextContent(
			'Could not persist the session model.',
		);
	},
};
