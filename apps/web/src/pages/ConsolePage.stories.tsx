import type { Meta, StoryObj } from '@storybook/react-vite';
import { JobEmptyState } from '@/components/job-empty-state';
import { JobHeader } from '@/components/job-header';
import { JobSidebar } from '@/components/job-sidebar';
import { JobStatusStrip } from '@/components/job-status-strip';
import { JobTimeline } from '@/components/job-timeline';
import type { TimelinePart } from '@/lib/event-adapter';

const meta: Meta = {
	title: 'Console',
	parameters: {
		layout: 'fullscreen',
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptySelection: Story = {
	render: () => (
		<div className="flex h-screen w-screen overflow-hidden bg-background">
			<JobSidebar
				grouped={[
					{
						label: 'TODAY',
						items: [
							{
								id: 'job-1',
								status: 'done',
								createdAt: Date.now() - 300_000,
								prompt: 'List files',
								cwd: '/Users/dev/project',
							},
						],
					},
				]}
				jobs={[
					{
						id: 'job-1',
						status: 'done',
						createdAt: Date.now() - 300_000,
						prompt: 'List files',
						cwd: '/Users/dev/project',
					},
				]}
				selectedId={undefined}
				isLoading={false}
				cwdFilter=""
				onCwdFilterChange={() => {}}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<JobEmptyState />
			</div>
		</div>
	),
};

export const RunningSession: Story = {
	render: () => (
		<div className="flex h-screen w-screen overflow-hidden bg-background">
			<JobSidebar
				grouped={[
					{
						label: 'TODAY',
						items: [
							{
								id: 'job-run',
								status: 'running',
								createdAt: Date.now() - 120_000,
								prompt: 'Refactor auth middleware',
								cwd: '/Users/dev/project',
								model: 'opencode-go/kimi-k2.6',
							},
							{
								id: 'job-done',
								status: 'done',
								createdAt: Date.now() - 400_000,
								prompt: 'List files in src/',
								cwd: '/Users/dev/project',
							},
						],
					},
				]}
				jobs={[
					{
						id: 'job-run',
						status: 'running',
						createdAt: Date.now() - 120_000,
						prompt: 'Refactor auth middleware',
						cwd: '/Users/dev/project',
						model: 'opencode-go/kimi-k2.6',
					},
					{
						id: 'job-done',
						status: 'done',
						createdAt: Date.now() - 400_000,
						prompt: 'List files in src/',
						cwd: '/Users/dev/project',
					},
				]}
				selectedId="job-run"
				isLoading={false}
				cwdFilter=""
				onCwdFilterChange={() => {}}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<JobStatusStrip status="Running tool: read_file" isRunning />
				<div className="flex min-h-0 flex-1 flex-col px-33 py-22">
					<div className="mx-auto flex w-full max-w-[900px] flex-col">
						<JobHeader
							id="job-run"
							status="running"
							prompt="Refactor the authentication middleware to use Effect.ts\nAdd proper error handling for all edge cases"
							cwd="/Users/dev/project/apps/api"
							model="opencode-go/kimi-k2.6"
							createdAt={Date.now() - 120_000}
							onCancel={() => {}}
						/>
						<div className="mt-22 min-h-0 flex-1">
							<JobTimeline
								cwd="/Users/dev/project/apps/api"
								parts={[
									{
										kind: 'reasoning',
										id: 'reasoning-1',
										text: 'I need to understand the current auth middleware structure before refactoring.',
										isStreaming: false,
										createdAt: Date.now() - 100_000,
										durationMs: 3200,
									} as TimelinePart,
									{
										kind: 'tool',
										id: 'tool-1',
										toolCallId: 'tc-1',
										toolName: 'read',
										title: 'auth.ts',
										toolKind: 'read',
										state: 'output-available',
										content: [
											{
												type: 'content',
												content: {
													type: 'text',
													text: 'export function auth(req, res, next) {\n  const token = req.headers.authorization;\n  if (!token) return res.status(401).send();\n  next();\n}',
												},
											},
										],
										locations: [
											{
												path: '/Users/dev/project/apps/api/src/middleware/auth.ts',
											},
										],
										rawInput: {
											filePath:
												'/Users/dev/project/apps/api/src/middleware/auth.ts',
										},
										createdAt: Date.now() - 90_000,
										durationMs: 800,
									},
									{
										kind: 'tool',
										id: 'tool-shell',
										toolCallId: 'tc-shell',
										toolName: 'bash',
										title: 'Run the test suite',
										toolKind: 'execute',
										state: 'output-available',
										content: [
											{
												type: 'content',
												content: {
													type: 'text',
													text: 'PASS  src/middleware/auth.test.ts\n  ✓ rejects missing token (3 ms)\n  ✓ calls next on valid token (1 ms)\n\nTest Suites: 1 passed, 1 total',
												},
											},
										],
										locations: [],
										rawInput: {
											command: 'bun test src/middleware/auth.test.ts',
											description: 'Run the test suite',
										},
										createdAt: Date.now() - 85_000,
										durationMs: 1200,
									},
									{
										kind: 'text',
										id: 'text-1',
										text: 'The current middleware is simple but lacks proper error handling and type safety.',
										createdAt: Date.now() - 80_000,
									} as TimelinePart,
									{
										kind: 'tool',
										id: 'tool-2',
										toolCallId: 'tc-2',
										toolName: 'write_file',
										title: 'write_file',
										state: 'input-streaming',
										content: [
											{
												type: 'content',
												content: {
													type: 'text',
													text: "import { Effect } from 'effect';\n\nexport const auth = Effect.sync(() => {",
												},
											},
										],
										locations: [{ path: 'src/middleware/auth.ts' }],
										createdAt: Date.now() - 5000,
										durationMs: undefined,
									},
									{
										kind: 'tool',
										id: 'tool-edit',
										toolCallId: 'tc-edit',
										toolName: 'edit',
										title: 'StrReplace',
										toolKind: 'edit',
										state: 'output-available',
										content: [
											{
												type: 'diff',
												path: '/Users/dev/project/apps/api/.github/workflows/deploy.yml',
												oldText:
													'name: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n',
												newText:
													'name: Deploy\non:\n  push:\n    branches: [main, staging]\njobs:\n  deploy:\n    runs-on: ubuntu-22.04\n',
											},
										],
										locations: [
											{
												path: '/Users/dev/project/apps/api/.github/workflows/deploy.yml',
											},
										],
										rawInput: {
											filePath:
												'/Users/dev/project/apps/api/.github/workflows/deploy.yml',
										},
										createdAt: Date.now() - 4000,
										durationMs: 500,
									},
									{
										kind: 'tool',
										id: 'tool-grep',
										toolCallId: 'tc-grep',
										toolName: 'grep',
										title: 'Grep',
										toolKind: 'search',
										state: 'output-available',
										content: [
											{
												type: 'content',
												content: {
													type: 'text',
													text: 'package.json:12:  "check:tsc": "tsc --noEmit"',
												},
											},
										],
										locations: [],
										rawInput: { pattern: 'check:tsc', include: 'package.json' },
										createdAt: Date.now() - 3000,
										durationMs: 120,
									},
									{
										kind: 'tool',
										id: 'tool-glob',
										toolCallId: 'tc-glob',
										toolName: 'glob',
										title: 'Glob',
										toolKind: 'search',
										state: 'output-available',
										content: [],
										locations: [],
										rawInput: { glob_pattern: '**/*.nonexistent' },
										createdAt: Date.now() - 2000,
										durationMs: 80,
									},
								]}
								streamingTail={null}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	),
};
