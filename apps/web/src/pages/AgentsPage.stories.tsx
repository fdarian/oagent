import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { orpc } from '@/lib/orpc';
import { OpenCodeTargetSelect } from './AgentsPage';

function HarnessMapping() {
	const [value, setValue] = useState('openwiki');
	const [queryClient] = useState(() => {
		const client = new QueryClient();
		client.setQueryData(
			orpc.agents.targets.queryOptions({ input: { backend: 'opencode' } })
				.queryKey,
			[
				{
					id: 'desktop',
					label: 'desktop',
					description:
						'Operates native macOS apps on the user’s Mac — clicking, typing, reading windows, screenshots, and more.',
				},
				{
					id: 'explore',
					label: 'explore',
					description: 'Explores the codebase.',
				},
				{
					id: 'openwiki',
					label: 'openwiki',
					description:
						'Searches, reads, initializes, and updates a repository’s OpenWiki.',
				},
				{
					id: 'oracle',
					label: 'oracle',
					description: 'Looks up external documentation.',
				},
			],
		);
		return client;
	});
	return (
		<QueryClientProvider client={queryClient}>
			<div className="w-[620px] max-w-full rounded-md border border-border p-4">
				<OpenCodeTargetSelect value={value} onChange={setValue} />
			</div>
		</QueryClientProvider>
	);
}

const meta: Meta<typeof HarnessMapping> = {
	title: 'Pages/Agents/Harness mappings',
	component: HarnessMapping,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};
export const Open: Story = {
	play: async (context) => {
		await userEvent.click(within(context.canvasElement).getByRole('combobox'));
		const popup = within(context.canvasElement.ownerDocument.body);
		await expect(popup.getAllByRole('option')).toHaveLength(4);
	},
};
