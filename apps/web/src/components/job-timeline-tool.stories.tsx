import type { Meta, StoryObj } from '@storybook/react-vite';
import { JobTimelineTool } from './job-timeline-tool';

const meta: Meta<typeof JobTimelineTool> = {
	component: JobTimelineTool,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const InputStreaming: Story = {
	args: {
		part: {
			kind: 'tool',
			id: 'tool-1',
			toolCallId: 'tc-1',
			toolName: 'write_file',
			title: 'write_file',
			state: 'input-streaming',
			content: [
				{
					type: 'content',
					content: {
						type: 'text',
						text: '{"path": "src/config.ts", "content": "export const config = {"',
					},
				},
			],
			locations: [{ path: 'src/config.ts' }],
			createdAt: Date.now() - 2000,
		},
	},
};

export const InputAvailable: Story = {
	args: {
		part: {
			kind: 'tool',
			id: 'tool-2',
			toolCallId: 'tc-2',
			toolName: 'shell',
			title: 'shell',
			state: 'input-available',
			content: [
				{ type: 'content', content: { type: 'text', text: '$ git status' } },
			],
			locations: [],
			createdAt: Date.now() - 3000,
		},
	},
};

export const OutputAvailable: Story = {
	args: {
		part: {
			kind: 'tool',
			id: 'tool-3',
			toolCallId: 'tc-3',
			toolName: 'read_file',
			title: 'read_file',
			state: 'output-available',
			content: [
				{
					type: 'content',
					content: { type: 'text', text: '127.0.0.1 localhost\n::1 localhost' },
				},
			],
			locations: [{ path: '/etc/hosts' }],
			createdAt: Date.now() - 5000,
			durationMs: 1200,
		},
	},
};

export const OutputError: Story = {
	args: {
		part: {
			kind: 'tool',
			id: 'tool-4',
			toolCallId: 'tc-4',
			toolName: 'shell',
			title: 'shell',
			state: 'output-error',
			content: [
				{
					type: 'content',
					content: {
						type: 'text',
						text: "$ rm -rf /\nrm: refusing to remove root directory: '/'",
					},
				},
			],
			locations: [],
			createdAt: Date.now() - 1000,
			durationMs: 300,
		},
	},
};
