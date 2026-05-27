import type { Meta, StoryObj } from '@storybook/react-vite';
import { JobEmptyState } from '@/components/job-empty-state';
import { JobHeader } from '@/components/job-header';
import { JobSidebar } from '@/components/job-sidebar';
import { JobStatusStrip } from '@/components/job-status-strip';
import { JobTimeline } from '@/components/job-timeline';
import type { TimelinePart } from '@/lib/event-adapter';

const meta: Meta = {
	title: 'ConsolePage',
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
				selectedId={undefined}
				isLoading={false}
				cwdFilter=""
				onCwdFilterChange={() => {}}
				onSelectJob={() => {}}
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
				selectedId="job-run"
				isLoading={false}
				cwdFilter=""
				onCwdFilterChange={() => {}}
				onSelectJob={() => {}}
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
										toolName: 'read_file',
										title: 'read_file',
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
										locations: [{ path: 'src/middleware/auth.ts' }],
										createdAt: Date.now() - 90_000,
										durationMs: 800,
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
