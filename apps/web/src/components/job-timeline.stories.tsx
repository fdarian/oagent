import type { Meta, StoryObj } from '@storybook/react-vite';
import type { TimelinePart } from '@/lib/event-adapter';
import { JobTimeline } from './job-timeline';

const meta: Meta<typeof JobTimeline> = {
	component: JobTimeline,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Minimal: Story = {
	args: {
		parts: [
			{
				kind: 'text',
				id: 'text-1',
				text: 'Hello! How can I help you today?',
				createdAt: Date.now(),
			},
		] as TimelinePart[],
	},
};

export const MidTool: Story = {
	args: {
		parts: [
			{
				kind: 'reasoning',
				id: 'reasoning-1',
				text: 'I need to read the file first to understand the context.',
				isStreaming: false,
				createdAt: Date.now() - 5000,
				durationMs: 1200,
			},
			{
				kind: 'tool',
				id: 'tool-1',
				toolCallId: 'tc-1',
				title: 'read_file',
				state: 'input-available',
				content: [
					{
						type: 'content',
						content: { type: 'text', text: '{"path": "src/index.ts"}' },
					},
				],
				locations: [{ path: 'src/index.ts' }],
				createdAt: Date.now() - 3000,
			},
		] as TimelinePart[],
	},
};

export const WithReasoning: Story = {
	args: {
		parts: [
			{
				kind: 'reasoning',
				id: 'reasoning-1',
				text: 'Let me think about the best approach to refactor this.',
				isStreaming: false,
				createdAt: Date.now() - 10_000,
				durationMs: 3400,
			},
			{
				kind: 'text',
				id: 'text-1',
				text: 'I recommend extracting the validation logic into a separate function.',
				createdAt: Date.now() - 5000,
			},
		] as TimelinePart[],
	},
};

export const WithError: Story = {
	args: {
		parts: [
			{
				kind: 'text',
				id: 'text-1',
				text: 'Attempting to connect to the database…',
				createdAt: Date.now() - 5000,
			},
			{
				kind: 'error',
				id: 'error-1',
				message: 'Connection refused: localhost:5432',
				code: 'ECONNREFUSED',
				createdAt: Date.now(),
			},
		] as TimelinePart[],
	},
};

export const FullMixed: Story = {
	args: {
		parts: [
			{
				kind: 'reasoning',
				id: 'reasoning-1',
				text: 'The user wants to list files. I should use the shell tool.',
				isStreaming: false,
				createdAt: Date.now() - 15_000,
				durationMs: 2100,
			},
			{
				kind: 'tool',
				id: 'tool-1',
				toolCallId: 'tc-1',
				title: 'shell',
				state: 'output-available',
				content: [
					{
						type: 'content',
						content: {
							type: 'text',
							text: 'total 24\ndrwxr-xr-x  5 dev  staff  160 May  1 12:00 .\ndrwxr-xr-x  3 dev  staff   96 May  1 11:50 ..\n-rw-r--r--  1 dev  staff  234 May  1 12:00 index.ts',
						},
					},
				],
				locations: [],
				createdAt: Date.now() - 10_000,
				durationMs: 800,
			},
			{
				kind: 'text',
				id: 'text-1',
				text: 'Here are the files in the `src/` directory:\n\n- `index.ts`',
				createdAt: Date.now() - 5000,
			},
		] as TimelinePart[],
	},
};
