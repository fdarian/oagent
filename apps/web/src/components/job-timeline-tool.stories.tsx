import type { Meta, StoryObj } from '@storybook/react-vite';
import { JobTimelineTool } from './job-timeline-tool';

const meta: Meta<typeof JobTimelineTool> = {
	component: JobTimelineTool,
};

export default meta;
type Story = StoryObj<typeof meta>;

const codeModePreviewImage =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const codeModeOverflowSource = Array.from(
	{ length: 48 },
	(_, index) =>
		`const issue${index + 1} = await tools.github.get_issue({ repository: 'oagent/oagent', number: ${index + 1} });`,
).join('\n');
const codeModeOverflowOutput = Array.from(
	{ length: 48 },
	(_, index) =>
		`issue-${index + 1}: "Platform follow-up ${index + 1} needs review"`,
).join('\n');

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

export const PatchText: Story = {
	args: {
		part: {
			kind: 'tool',
			id: 'tool-patch',
			toolCallId: 'tc-patch',
			toolName: 'patch',
			title: 'patch',
			toolKind: 'edit',
			state: 'output-available',
			content: [],
			locations: [],
			rawInput: {
				patchText: `*** Begin Patch
*** Update File: src/config.ts
@@
-export const port = 3000;
+export const port = 3001;
*** End Patch`,
			},
			createdAt: Date.now() - 500,
			durationMs: 100,
		},
	},
};

export const Skill: Story = {
	args: {
		part: {
			kind: 'tool',
			id: 'tool-skill',
			toolCallId: 'tc-skill',
			toolName: 'skill',
			title: 'Skill',
			state: 'output-available',
			content: [],
			locations: [],
			rawInput: { id: 'code-ts' },
			rawOutput: { formatted_output: 'Loaded skill code-ts' },
			createdAt: Date.now() - 500,
			durationMs: 100,
		},
	},
};

export const CodeModeCompleted: Story = {
	args: {
		cwd: '/Users/dev/project',
		part: {
			kind: 'tool',
			id: 'tool-code-mode-completed',
			toolCallId: 'tc-code-mode-completed',
			toolName: 'execute',
			title: 'execute',
			toolKind: 'other',
			state: 'output-available',
			content: [
				{
					type: 'content',
					content: {
						type: 'text',
						text: '{\n  "repositories": [\n    "oagent",\n    "opencode"\n  ]\n}',
					},
				},
				{
					type: 'content',
					content: {
						type: 'image',
						mimeType: 'image/png',
						data: codeModePreviewImage,
					},
				},
			],
			locations: [],
			rawInput: {
				code: `const repositories = await tools.github.search_repositories({
	query: 'language:typescript stars:>1000',
});

return repositories
	.filter((repository) => repository.archived !== true)
	.map((repository) => ({
		name: repository.name,
		stars: repository.stargazers_count,
	}))
	.sort((left, right) => right.stars - left.stars)
	.slice(0, 10);`,
			},
			rawOutput: {
				output: '{\n  "repositories": [\n    "oagent",\n    "opencode"\n  ]\n}',
				attachments: [
					{
						type: 'file',
						mime: 'image/png',
						url: `data:image/png;base64,${codeModePreviewImage}`,
						filename: 'repositories.png',
					},
				],
				metadata: {
					toolCalls: [
						{
							tool: 'github.search_repositories',
							status: 'completed',
							input: { query: 'language:typescript stars:>1000' },
						},
					],
				},
			},
			createdAt: Date.now() - 8000,
			durationMs: 4200,
		},
	},
};

export const CodeModeRunning: Story = {
	args: {
		cwd: '/Users/dev/project',
		part: {
			kind: 'tool',
			id: 'tool-code-mode-running',
			toolCallId: 'tc-code-mode-running',
			toolName: 'execute',
			title: 'execute',
			toolKind: 'other',
			state: 'input-available',
			content: [],
			locations: [],
			rawInput: {
				code: `const issues = await tools.linear.list_issues({
	team: 'platform',
	state: 'In Progress',
});

return issues.map((issue) => issue.identifier);`,
			},
			createdAt: Date.now() - 1600,
		},
	},
};

export const CodeModeFailed: Story = {
	args: {
		cwd: '/Users/dev/project',
		part: {
			kind: 'tool',
			id: 'tool-code-mode-failed',
			toolCallId: 'tc-code-mode-failed',
			toolName: 'execute',
			title: 'execute',
			toolKind: 'other',
			state: 'output-error',
			content: [
				{
					type: 'content',
					content: {
						type: 'text',
						text: 'Tool github.get_issue failed: issue not found',
					},
				},
			],
			locations: [],
			rawInput: {
				code: `const issue = await tools.github.get_issue({
		repository: 'oagent/oagent',
		number: 404,
});

return issue.title;`,
			},
			rawOutput: {
				error: 'Tool github.get_issue failed: issue not found',
				metadata: {
					error: true,
					toolCalls: [
						{
							tool: 'github.get_issue',
							status: 'error',
							input: { repository: 'oagent/oagent', number: 404 },
						},
					],
				},
			},
			createdAt: Date.now() - 2500,
			durationMs: 900,
		},
	},
};

export const CodeModeOverflow: Story = {
	args: {
		cwd: '/Users/dev/project',
		part: {
			kind: 'tool',
			id: 'tool-code-mode-overflow',
			toolCallId: 'tc-code-mode-overflow',
			toolName: 'execute',
			title: 'execute',
			toolKind: 'other',
			state: 'output-available',
			content: [
				{
					type: 'content',
					content: { type: 'text', text: codeModeOverflowOutput },
				},
			],
			locations: [],
			rawInput: { code: codeModeOverflowSource },
			rawOutput: {
				output: codeModeOverflowOutput,
				metadata: {
					toolCalls: [
						{
							tool: 'github.get_issue',
							status: 'completed',
							input: {
								repository: 'oagent/oagent',
								number: 1,
							},
						},
					],
				},
			},
			createdAt: Date.now() - 6500,
			durationMs: 3800,
		},
	},
};
