import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { orpc } from '@/lib/orpc';
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

export const SwitchModel: Story = {
	args: { ...base, status: 'running' },
	render: function Render(args) {
		const [model, setModel] = useState(base.model);
		const [queryClient] = useState(() => {
			const client = new QueryClient();
			client.setQueryData(
				orpc.models.list.key({ input: { backend: 'opencode' }, type: 'query' }),
				[
					{ id: base.model, label: 'Kimi K2.6' },
					{ id: 'provider/next-model', label: 'Next model' },
				],
			);
			return client;
		});
		return (
			<QueryClientProvider client={queryClient}>
				<JobHeader
					{...args}
					sessionModelControl={{ model, onChange: setModel, isPending: false }}
				/>
			</QueryClientProvider>
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
