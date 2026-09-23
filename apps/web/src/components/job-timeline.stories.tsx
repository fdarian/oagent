import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { fn } from 'storybook/test';
import type { TimelinePart } from '@/lib/event-adapter';
import { JobHeader } from './job-header';
import { JobStatusStrip } from './job-status-strip';
import { JobTimeline } from './job-timeline';
import { createSubagentFixture } from './subagent-fixtures';
import { SubagentHeader } from './subagent-header';

const meta: Meta<typeof JobTimeline> = {
	component: JobTimeline,
	args: {
		cwd: '/Users/dev/project',
	},
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
		] satisfies TimelinePart[],
		streamingTail: null,
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
				toolName: 'read_file',
				title: 'read_file',
				toolKind: 'read',
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
		] satisfies TimelinePart[],
		streamingTail: null,
	},
};

export const ExplorationTools: Story = {
	args: {
		cwd: '/Users/dev/project',
		parts: [
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
				rawInput: {
					glob_pattern: 'src/**/*.{tsx,ts,css}',
					target_directory: '.',
				},
				createdAt: Date.now() - 4000,
			},
			{
				kind: 'tool',
				id: 'tool-read',
				toolCallId: 'tc-read',
				toolName: 'read',
				title: 'Read',
				toolKind: 'read',
				state: 'output-available',
				content: [
					{
						type: 'content',
						content: { type: 'text', text: 'export function App() {}' },
					},
				],
				locations: [{ path: '/Users/dev/project/src/App.tsx' }],
				rawInput: { filePath: '/Users/dev/project/src/App.tsx' },
				createdAt: Date.now() - 3000,
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
							text: 'src/App.tsx:1:export function App() {}',
						},
					},
				],
				locations: [],
				rawInput: { pattern: 'App', include: 'src' },
				createdAt: Date.now() - 2000,
			},
		] satisfies TimelinePart[],
		streamingTail: null,
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
		] satisfies TimelinePart[],
		streamingTail: null,
	},
};

export const WithSteerMessages: Story = {
	args: {
		parts: [
			{
				kind: 'text',
				id: 'text-before-steer',
				text: 'I’ll update the API implementation next.',
				createdAt: Date.now() - 5000,
			},
			{
				kind: 'steer',
				id: 'steer-short',
				text: 'Please add a test for the error case too.',
				createdAt: Date.now() - 4000,
			},
			{
				kind: 'steer',
				id: 'steer-long',
				text: 'Before you finish, keep the public API backwards compatible.\nAdd coverage for both successful and failed requests.\nUse the existing error type rather than introducing another one.\nUpdate the Storybook example so the new state can be reviewed.\nThen run the package checks and report any unrelated failures.',
				createdAt: Date.now() - 3000,
			},
			{
				kind: 'text',
				id: 'text-after-steer',
				text: 'Got it — I’ll include those changes.',
				createdAt: Date.now() - 2000,
			},
		] satisfies TimelinePart[],
		streamingTail: null,
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
		] satisfies TimelinePart[],
		streamingTail: null,
	},
};

const fullMixedParts = [
	{
		kind: 'reasoning',
		id: 'reasoning-1',
		text: 'I need to inspect the timeline components before updating the story.',
		isStreaming: false,
		createdAt: Date.now() - 30_000,
		durationMs: 1200,
	},
	{
		kind: 'reasoning',
		id: 'reasoning-2',
		text: 'Then I can make the change and verify the rendered output.',
		isStreaming: false,
		createdAt: Date.now() - 28_000,
		durationMs: 900,
	},
	{
		kind: 'tool',
		id: 'tool-skill-ts',
		toolCallId: 'tc-skill-ts',
		toolName: 'skill',
		title: 'Skill',
		state: 'output-available',
		content: [],
		locations: [],
		rawInput: { id: 'code-ts' },
		rawOutput: { formatted_output: 'Loaded skill code-ts' },
		createdAt: Date.now() - 26_000,
		durationMs: 100,
	},
	{
		kind: 'tool',
		id: 'tool-skill-effect',
		toolCallId: 'tc-skill-effect',
		toolName: 'skill',
		title: 'Skill',
		state: 'output-available',
		content: [],
		locations: [],
		rawInput: { id: 'code-ts-effect' },
		rawOutput: { formatted_output: 'Loaded skill code-ts-effect' },
		createdAt: Date.now() - 25_000,
		durationMs: 100,
	},
	{
		kind: 'tool',
		id: 'tool-read',
		toolCallId: 'tc-read',
		toolName: 'read',
		title: 'Read',
		toolKind: 'read',
		state: 'output-available',
		content: [
			{
				type: 'content',
				content: {
					type: 'text',
					text: 'export function JobTimeline() {\n\treturn <Conversation />;\n}',
				},
			},
		],
		locations: [
			{
				path: '/Users/dev/project/apps/web/src/components/job-timeline.tsx',
			},
		],
		rawInput: {
			filePath: '/Users/dev/project/apps/web/src/components/job-timeline.tsx',
		},
		createdAt: Date.now() - 23_000,
		durationMs: 400,
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
				path: '/Users/dev/project/apps/web/src/components/job-timeline.stories.tsx',
				oldText: 'export const FullMixed: Story = {\n\targs: {},\n};\n',
				newText:
					'export const FullMixed: Story = {\n\targs: {\n\t\tparts: [],\n\t},\n};\n',
			},
		],
		locations: [
			{
				path: '/Users/dev/project/apps/web/src/components/job-timeline.stories.tsx',
			},
		],
		rawInput: {
			filePath:
				'/Users/dev/project/apps/web/src/components/job-timeline.stories.tsx',
		},
		createdAt: Date.now() - 20_000,
		durationMs: 600,
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
		rawInput: {
			glob_pattern: 'apps/web/src/components/job-timeline*.tsx',
		},
		createdAt: Date.now() - 17_000,
		durationMs: 120,
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
					text: 'apps/web/src/components/job-timeline.tsx:79:function collapseExplorationParts',
				},
			},
		],
		locations: [],
		rawInput: {
			pattern: 'collapseExplorationParts',
			include: 'apps/web/src/components/job-timeline.tsx',
		},
		createdAt: Date.now() - 16_000,
		durationMs: 100,
	},
	{
		kind: 'tool',
		id: 'tool-explored-read',
		toolCallId: 'tc-explored-read',
		toolName: 'read',
		title: 'Read',
		toolKind: 'read',
		state: 'output-available',
		content: [
			{
				type: 'content',
				content: {
					type: 'text',
					text: 'function collapseExplorationParts(parts: TimelinePart[]) {\n\t// …\n}',
				},
			},
		],
		locations: [
			{
				path: '/Users/dev/project/apps/web/src/components/job-timeline.tsx',
			},
		],
		rawInput: {
			filePath: '/Users/dev/project/apps/web/src/components/job-timeline.tsx',
		},
		createdAt: Date.now() - 15_000,
		durationMs: 300,
	},
	{
		kind: 'tool',
		id: 'tool-shell',
		toolCallId: 'tc-shell',
		toolName: 'bash',
		title: 'Check the timeline story',
		toolKind: 'execute',
		state: 'output-available',
		content: [
			{
				type: 'content',
				content: {
					type: 'text',
					text: 'Checked 1 file. No fixes applied.',
				},
			},
		],
		locations: [],
		rawInput: {
			command:
				'pnpm exec biome check apps/web/src/components/job-timeline.stories.tsx',
			description: 'Check the timeline story',
		},
		createdAt: Date.now() - 13_000,
		durationMs: 900,
	},
	{
		kind: 'text',
		id: 'text-1',
		text: 'Updated the mixed timeline fixture and verified the story.',
		createdAt: Date.now() - 10_000,
	},
] satisfies TimelinePart[];

const fullMixedStepMs = 750;

function streamingPartAt(index: number): TimelinePart | null {
	const part = fullMixedParts[index];
	if (part === undefined) return null;

	if (part.kind === 'reasoning') {
		return { ...part, isStreaming: true };
	}

	if (part.kind === 'tool') {
		return { ...part, state: 'input-available' };
	}

	return part;
}

function StreamedFullMixed() {
	const [completedPartCount, setCompletedPartCount] = useState(0);

	useEffect(() => {
		if (completedPartCount === fullMixedParts.length) return;

		const timeout = window.setTimeout(() => {
			setCompletedPartCount(
				(currentCompletedPartCount) => currentCompletedPartCount + 1,
			);
		}, fullMixedStepMs);

		return () => window.clearTimeout(timeout);
	}, [completedPartCount]);

	return (
		<JobTimeline
			cwd="/Users/dev/project"
			parts={fullMixedParts.slice(0, completedPartCount)}
			streamingTail={streamingPartAt(completedPartCount)}
		/>
	);
}

export const FullMixed: Story = {
	render: () => <StreamedFullMixed />,
};

export const SubagentParent: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'timeline-parent-child',
			status: 'completed',
			title: 'Say hi',
			description: 'Say hi',
			agentName: 'general',
		});
		return {
			parts: fixture.display.parts,
			streamingTail: fixture.display.streamingTail,
			childSessions: fixture.display.children,
			onChildSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};

export const SubagentParentRunning: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'timeline-parent-child-running',
			status: 'running',
			title: 'Say hi',
			description: 'Say hi',
			agentName: 'general',
		});
		return {
			parts: fixture.display.parts,
			streamingTail: fixture.display.streamingTail,
			childSessions: fixture.display.children,
			onChildSelect: fn<(sessionId: string) => void>(),
		};
	})(),
};

export const SubagentChild: Story = {
	args: (() => {
		const fixture = createSubagentFixture({
			id: 'timeline-child',
			status: 'running',
			title: 'Inspect the event model',
			agentName: 'explore',
		});
		if (fixture.child === undefined) throw new Error('Missing timeline child');
		return {
			parts: fixture.child.parts,
			streamingTail: fixture.child.streamingTail,
			childSessions: fixture.display.children,
			currentChild: fixture.child,
			isChildTimeline: true,
			header: (
				<SubagentHeader
					child={fixture.child}
					sessions={fixture.display.children}
					onNavigate={fn<(sessionId: string | undefined) => void>()}
				/>
			),
		};
	})(),
};

const interactiveFixture = createSubagentFixture({
	id: 'interactive-child',
	status: 'running',
	title: 'Inspect the event model',
	description: 'Inspect the event model',
	agentName: 'general',
});

function InteractiveSubagentTimeline() {
	const [activeChildSessionId, setActiveChildSessionId] = useState<
		string | undefined
	>(undefined);
	const activeChild =
		activeChildSessionId === undefined
			? undefined
			: interactiveFixture.display.children.get(activeChildSessionId);
	const handleChildSelect = (sessionId: string) => {
		interactiveChildSelect(sessionId);
		setActiveChildSessionId(sessionId);
	};
	const handleChildNavigate = (sessionId: string | undefined) => {
		interactiveChildNavigate(sessionId);
		setActiveChildSessionId(sessionId);
	};
	return (
		<div className="flex h-screen w-screen flex-col bg-background">
			<JobStatusStrip
				status={
					activeChild?.lastStatus ?? interactiveFixture.display.lastStatus
				}
				isRunning={
					activeChild?.status === 'running' || activeChild === undefined
				}
			/>
			<div className="flex min-h-0 flex-1 flex-col">
				<JobTimeline
					key={activeChild?.id ?? 'parent'}
					parts={activeChild?.parts ?? interactiveFixture.display.parts}
					streamingTail={
						activeChild?.streamingTail ??
						interactiveFixture.display.streamingTail
					}
					cwd="/Users/dev/project"
					childSessions={interactiveFixture.display.children}
					currentChild={activeChild}
					activeChildSessionId={activeChildSessionId}
					onChildSelect={handleChildSelect}
					isChildTimeline={activeChild !== undefined}
					header={
						activeChild === undefined ? (
							<div className="px-33 py-22">
								<div className="mx-auto max-w-[900px]">
									<JobHeader
										id="job-subagent-story"
										status="running"
										prompt="Review the authentication middleware and delegate the event-model inspection."
										cwd="/Users/dev/project"
										backend="opencode"
										model="opencode-go/kimi-k2.6"
										createdAt={Date.now() - 12_000}
									/>
								</div>
							</div>
						) : (
							<SubagentHeader
								child={activeChild}
								sessions={interactiveFixture.display.children}
								onNavigate={handleChildNavigate}
							/>
						)
					}
				/>
			</div>
		</div>
	);
}

const interactiveChildSelect = fn<(sessionId: string) => void>();
const interactiveChildNavigate = fn<(sessionId: string | undefined) => void>();

export const InteractiveSubagentNavigation: Story = {
	render: () => <InteractiveSubagentTimeline />,
};
