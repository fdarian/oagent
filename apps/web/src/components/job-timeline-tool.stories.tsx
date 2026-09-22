import type { Meta, StoryObj } from '@storybook/react-vite';
import { JobTimelineTool } from './job-timeline-tool';

const meta: Meta<typeof JobTimelineTool> = {
	component: JobTimelineTool,
};

export default meta;
type Story = StoryObj<typeof meta>;

const codeModePreviewImage =
	'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMzYwIiB2aWV3Qm94PSIwIDAgNjQwIDM2MCI+PHJlY3Qgd2lkdGg9IjY0MCIgaGVpZ2h0PSIzNjAiIHJ4PSIyNCIgZmlsbD0iIzE3MjAzMyIvPjx0ZXh0IHg9IjQwIiB5PSI1OCIgZmlsbD0iI2Y4ZmFmYyIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjgiIGZvbnQtd2VpZ2h0PSI3MDAiPlJlcG9zaXRvcnkgaGVhbHRoPC90ZXh0Pjx0ZXh0IHg9IjQwIiB5PSI4OCIgZmlsbD0iIzk0YTNiOCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYiPldlZWtseSBlbmdpbmVlcmluZyBvdmVydmlldzwvdGV4dD48cmVjdCB4PSI0MCIgeT0iMTI1IiB3aWR0aD0iNTYwIiBoZWlnaHQ9IjE3NSIgcng9IjE2IiBmaWxsPSIjMjQzMjRhIi8+PGxpbmUgeDE9IjgyIiB5MT0iMjYwIiB4Mj0iNTYwIiB5Mj0iMjYwIiBzdHJva2U9IiM2NDc0OGIiLz48cmVjdCB4PSIxMDUiIHk9IjIwNSIgd2lkdGg9IjUyIiBoZWlnaHQ9IjU1IiByeD0iNiIgZmlsbD0iIzM4YmRmOCIvPjxyZWN0IHg9IjE5MCIgeT0iMTc1IiB3aWR0aD0iNTIiIGhlaWdodD0iODUiIHJ4PSI2IiBmaWxsPSIjMzRkMzk5Ii8+PHJlY3QgeD0iMjc1IiB5PSIxNTAiIHdpZHRoPSI1MiIgaGVpZ2h0PSIxMTAiIHJ4PSI2IiBmaWxsPSIjZmJiZjI0Ii8+PHJlY3QgeD0iMzYwIiB5PSIxODUiIHdpZHRoPSI1MiIgaGVpZ2h0PSI3NSIgcng9IjYiIGZpbGw9IiNhNzhiZmEiLz48cmVjdCB4PSI0NDUiIHk9IjEzNSIgd2lkdGg9IjUyIiBoZWlnaHQ9IjEyNSIgcng9IjYiIGZpbGw9IiNmYjcxODUiLz48dGV4dCB4PSIxMDUiIHk9IjI4NSIgZmlsbD0iI2NiZDVlMSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiPk1vbjwvdGV4dD48dGV4dCB4PSIxOTAiIHk9IjI4NSIgZmlsbD0iI2NiZDVlMSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiPlR1ZTwvdGV4dD48dGV4dCB4PSIyNzUiIHk9IjI4NSIgZmlsbD0iI2NiZDVlMSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiPldlZDwvdGV4dD48dGV4dCB4PSIzNjAiIHk9IjI4NSIgZmlsbD0iI2NiZDVlMSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiPlRodTwvdGV4dD48dGV4dCB4PSI0NDUiIHk9IjI4NSIgZmlsbD0iI2NiZDVlMSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiPkZyaTwvdGV4dD48L3N2Zz4=';
const codeModeDistinctImage =
	'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMzYwIiB2aWV3Qm94PSIwIDAgNjQwIDM2MCI+PHJlY3Qgd2lkdGg9IjY0MCIgaGVpZ2h0PSIzNjAiIHJ4PSIyNCIgZmlsbD0iIzNiMWYzMiIvPjx0ZXh0IHg9IjQwIiB5PSI1OCIgZmlsbD0iI2ZmZjFmMiIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjgiIGZvbnQtd2VpZ2h0PSI3MDAiPlJlbGVhc2UgcmVhZGluZXNzPC90ZXh0Pjx0ZXh0IHg9IjQwIiB5PSI4OCIgZmlsbD0iI2ZlY2RkMyIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYiPkNoZWNrcyBjb21wbGV0ZWQgZm9yIHRoaXMgZGVwbG95PC90ZXh0PjxyZWN0IHg9IjQwIiB5PSIxMjUiIHdpZHRoPSI1NjAiIGhlaWdodD0iMTc1IiByeD0iMTYiIGZpbGw9IiM1YTI5NDUiLz48Y2lyY2xlIGN4PSIxNjAiIGN5PSIyMTIiIHI9IjQyIiBmaWxsPSIjZmI3MTg1Ii8+PHBhdGggZD0iTTEzOCAyMTJsMTQgMTQgMzEtMzUiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZjFmMiIgc3Ryb2tlLXdpZHRoPSIxMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PHRleHQgeD0iMjM1IiB5PSIyMDUiIGZpbGw9IiNmZmYxZjIiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjI0IiBmb250LXdlaWdodD0iNzAwIj5BbGwgY2hlY2tzIHBhc3NlZDwvdGV4dD48dGV4dCB4PSIyMzUiIHk9IjIzNyIgZmlsbD0iI2ZlY2RkMyIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTciPlJlYWR5IGZvciByZXZpZXc8L3RleHQ+PC9zdmc+';
const codeModePreviewAudio =
	'UklGRqQCAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYACAAAAAM4KRBRIGwofHB+DG7IUfAv6AGz2EO3/5QvipeHU5DHr+PMb/mUIohG6GNwckR3IGtsUhAzBAr74pe+L6EDkQuOq5SfrEPNx/CwGHA8zFqAa4hvYGccUSw1NBN76G/IL64HmAeWx5lrrafIF+yUEtwy6E1wYFhq6GHYU0g2bBcv8bfR97cno2ubm58frAvLW+VMCeQpSERMWMRhwF+4TGw6qBoL+l/bZ7xDryuhE6Wrs2PHl+LgAZAgCD80TOBYAFjETJg58BwAAlfgb8lPtyerE6kDt6/Ez+Ff/fQbPDI8RMxRvFEMS9g0PCEQBZfo/9Ivv0+xk7EXuN/K+9zD+xgS8Cl4PJhLDEikRjg1mCE4CA/xA9rPx4u4d7nTvuvKG90T9QgPOCEANFhD/EOYP8QyACBwDbP0a+Mfz8fDp78nwcPOJ95T89AEJBzkLCg4rD38OIgxfCK4Dnv7J+cD1+fLE8UDyV/TG9yD83QBwBU8JBwxLDfoMJQsHCAQEmf9K+5v39vSo89LzavU6+Of7AAAHBIUHEgpkC1sL/Ql4Bx8EWQCa/FL54vaP9Xz1pvbi+On7Xf/RAuAFMAh9CagJrwi3BgAE4AC3/eP6ufh19zj3Bfi8+SX88/7PAWQEZgabB+UHQAfGBakDLAGe/kn8dPpS+QH5g/nD+pf8xP4EARUDuQTDBRgGtAWpBBsDPgFN/4H9Efwj+9D6G/v1+z/9z/5xAPUBLgP7A0cEEQRkA1kCFgHD/4j+iv3i/KH8yPxN/Rr+E/8XAAcByQFHAngCWwL6AWYBtgAAAFz/2/6K/m7+hf7G/iT/j//4/08AjQCsAK4AmAByAEYAHgADAPn/';
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

export const CodeModeAcpMediaContent: Story = {
	args: {
		cwd: '/Users/dev/project',
		part: {
			kind: 'tool',
			id: 'tool-code-mode-acp-media',
			toolCallId: 'tc-code-mode-acp-media',
			toolName: 'execute',
			title: 'execute',
			toolKind: 'other',
			state: 'output-available',
			content: [
				{
					type: 'content',
					content: {
						type: 'text',
						text: 'Repository health report is ready.',
					},
				},
				{
					type: 'content',
					content: {
						type: 'image',
						mimeType: 'image/svg+xml',
						data: codeModePreviewImage,
					},
				},
				{
					type: 'content',
					content: {
						type: 'audio',
						mimeType: 'audio/wav',
						data: codeModePreviewAudio,
					},
				},
			],
			locations: [],
			rawInput: {
				code: `const report = await tools.github.get_repository_health({
	owner: 'oagent',
	repository: 'oagent',
});

return report;`,
			},
			rawOutput: {
				output: 'Repository health report is ready.',
				metadata: { toolCalls: [] },
			},
			createdAt: Date.now() - 7000,
			durationMs: 3500,
		},
	},
};

export const CodeModeMediaAttachments: Story = {
	args: {
		cwd: '/Users/dev/project',
		part: {
			kind: 'tool',
			id: 'tool-code-mode-attachments',
			toolCallId: 'tc-code-mode-attachments',
			toolName: 'execute',
			title: 'execute',
			toolKind: 'other',
			state: 'output-available',
			content: [
				{
					type: 'content',
					content: {
						type: 'text',
						text: 'Repository health report is ready.',
					},
				},
				{
					type: 'content',
					content: {
						type: 'image',
						mimeType: 'image/svg+xml',
						data: codeModePreviewImage,
					},
				},
			],
			locations: [],
			rawInput: {
				code: `const report = await tools.github.get_repository_health({
	owner: 'oagent',
	repository: 'oagent',
});

return report;`,
			},
			rawOutput: {
				output: 'Repository health report is ready.',
				attachments: [
					{
						type: 'file',
						mime: 'image/svg+xml',
						url: `data:image/svg+xml;charset=utf-8;base64,${codeModePreviewImage}`,
						filename: 'repository-health-duplicate.svg',
					},
					{
						type: 'file',
						mime: 'image/svg+xml',
						url: `data:image/svg+xml;base64,${codeModeDistinctImage}`,
						filename: 'release-readiness.svg',
					},
					{
						type: 'file',
						mime: 'audio/wav',
						url: `data:audio/wav;base64,${codeModePreviewAudio}`,
						filename: 'repository-health.wav',
					},
				],
				metadata: { toolCalls: [] },
			},
			createdAt: Date.now() - 7000,
			durationMs: 3500,
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
