import type { SessionUpdate } from '@oagent/engine';
import {
	applyEvent,
	type ChildSessionStatus,
	type ChildTimeline,
	createInitialState,
	type DisplayState,
	type ReduceState,
	type TimelineToolPart,
	toDisplayState,
} from '@/lib/event-adapter';

const fixtureStart = Date.now() - 12_000;

export const longSubagentDescription =
	'Inspect the authentication middleware, compare the existing error paths, and propose a backwards-compatible refactor with focused test coverage';

export type SubagentFixtureOptions = {
	id?: string;
	parentId?: string;
	depth?: number;
	title?: string;
	description?: string;
	agentName?: string;
	status?: ChildSessionStatus;
	legacy?: boolean;
	activity?: string;
};

export type SubagentFixture = {
	display: DisplayState;
	parent: TimelineToolPart;
	child: ChildTimeline | undefined;
};

export type SubagentCollectionFixture = {
	display: DisplayState;
	children: ReadonlyMap<string, ChildTimeline>;
};

function childMeta(
	id: string,
	parentId: string,
	depth: number,
	title: string,
): Record<string, unknown> {
	return {
		'opencode/child-session': { id, parentID: parentId, depth, title },
	};
}

function apply(
	state: ReduceState,
	event: SessionUpdate,
	createdAt: number,
): ReduceState {
	return applyEvent(state, event, createdAt);
}

function parentToolFrom(display: DisplayState): TimelineToolPart {
	const parent = display.parts.find(
		(part): part is TimelineToolPart => part.kind === 'tool',
	);
	if (parent === undefined) throw new Error('Missing subagent parent tool');
	return parent;
}

function childInput(options: SubagentFixtureOptions): Record<string, unknown> {
	const agentName = options.agentName ?? 'general';
	const description =
		options.description ?? options.title ?? 'Explore the code';
	if (options.legacy === true) {
		return {
			subagent_type: agentName,
			description,
		};
	}
	return {
		agent: agentName,
		description,
	};
}

function childIdFor(options: SubagentFixtureOptions): string {
	return options.id ?? 'child-1';
}

function parentIdFor(options: SubagentFixtureOptions): string {
	return options.parentId ?? 'root-session';
}

function titleFor(options: SubagentFixtureOptions): string {
	return options.title ?? 'Inspect the event model';
}

function parentToolName(options: SubagentFixtureOptions): string {
	return options.legacy === true ? 'task' : 'subagent';
}

function parentToolEvent(
	options: SubagentFixtureOptions,
	toolCallId: string,
): SessionUpdate {
	return {
		sessionUpdate: 'tool_call',
		toolCallId,
		title: parentToolName(options),
		status: 'in_progress',
		rawInput: childInput(options),
	} as SessionUpdate;
}

function childThoughtEvent(
	options: SubagentFixtureOptions,
	text = 'I am tracing the relevant code paths before making a change.',
): SessionUpdate {
	return {
		sessionUpdate: 'agent_thought_chunk',
		messageId: `${childIdFor(options)}-thought`,
		content: { type: 'text', text },
		_meta: childMeta(
			childIdFor(options),
			parentIdFor(options),
			options.depth ?? 1,
			titleFor(options),
		),
	} as SessionUpdate;
}

function childToolEvent(options: SubagentFixtureOptions): SessionUpdate {
	return {
		sessionUpdate: 'tool_call',
		toolCallId: `${childIdFor(options)}:read`,
		title: options.activity ?? 'Read the relevant source files',
		kind: 'read',
		status: 'completed',
		content: [
			{
				type: 'content',
				content: {
					type: 'text',
					text: 'export function inspectTimeline() { return true; }',
				},
			},
		],
		locations: [{ path: 'apps/web/src/lib/event-adapter.ts' }],
		rawInput: { filePath: 'apps/web/src/lib/event-adapter.ts' },
		_meta: childMeta(
			childIdFor(options),
			parentIdFor(options),
			options.depth ?? 1,
			titleFor(options),
		),
	} as SessionUpdate;
}

function completeParentEvent(
	options: SubagentFixtureOptions,
	toolCallId: string,
): SessionUpdate {
	const status = options.status === 'failed' ? 'failed' : 'completed';
	const sessionKey = options.legacy === true ? 'sessionId' : 'sessionID';
	return {
		sessionUpdate: 'tool_call_update',
		toolCallId,
		status,
		rawOutput: {
			metadata: { [sessionKey]: childIdFor(options) },
		},
	} as SessionUpdate;
}

export function createSubagentFixture(
	options: SubagentFixtureOptions = {},
): SubagentFixture {
	const childId = childIdFor(options);
	const parentToolId = `${childId}:parent-call`;
	const parentCreatedAt = fixtureStart;
	const childCreatedAt = parentCreatedAt + 100;
	const childToolCreatedAt = parentCreatedAt + 300;
	const parentEndedAt = parentCreatedAt + 1000;
	let state = createInitialState();
	state = apply(state, parentToolEvent(options, parentToolId), parentCreatedAt);
	if (options.status !== undefined || options.id !== undefined) {
		state = apply(state, childThoughtEvent(options), childCreatedAt);
		state = apply(state, childToolEvent(options), childToolCreatedAt);
	}
	if (options.status === 'completed' || options.status === 'failed') {
		state = apply(
			state,
			completeParentEvent(options, parentToolId),
			parentEndedAt,
		);
	}
	const display = toDisplayState(state);
	return {
		display,
		parent: parentToolFrom(display),
		child: display.children.get(childId),
	};
}

export function createPendingSubagentFixture(): SubagentFixture {
	return createSubagentFixture();
}

export function createConcurrentSubagentFixture(
	count: number,
	activity?: string,
): SubagentCollectionFixture {
	let state = createInitialState();
	for (let index = 0; index < count; index += 1) {
		const childNumber = index + 1;
		const options: SubagentFixtureOptions = {
			id: `child-${childNumber}`,
			title: `Concurrent investigation ${childNumber}`,
			description: `Concurrent investigation ${childNumber}`,
			agentName: childNumber % 2 === 0 ? 'explore' : 'general',
			activity,
		};
		const parentCreatedAt = fixtureStart + index * 1000;
		state = apply(
			state,
			parentToolEvent(options, `${options.id}:parent-call`),
			parentCreatedAt,
		);
		state = apply(state, childThoughtEvent(options), parentCreatedAt + 100);
		state = apply(state, childToolEvent(options), parentCreatedAt + 300);
	}
	const display = toDisplayState(state);
	return { display, children: display.children };
}

export function createNestedSubagentFixture(): SubagentCollectionFixture {
	const outerOptions: SubagentFixtureOptions = {
		id: 'outer-child',
		title: 'Inspect the authentication flow',
		description: 'Inspect the authentication flow',
		agentName: 'general',
	};
	const nestedOptions: SubagentFixtureOptions = {
		id: 'nested-child',
		parentId: 'outer-child',
		depth: 2,
		title: 'Trace the token validator',
		description: 'Trace the token validator',
		agentName: 'explore',
	};
	let state = createInitialState();
	state = apply(
		state,
		parentToolEvent(outerOptions, 'outer-parent-call'),
		fixtureStart,
	);
	state = apply(state, childThoughtEvent(outerOptions), fixtureStart + 100);
	state = apply(
		state,
		{
			sessionUpdate: 'tool_call',
			toolCallId: 'outer-child:nested-parent-call',
			title: 'subagent',
			status: 'in_progress',
			rawInput: childInput(nestedOptions),
			_meta: childMeta(
				'outer-child',
				'root-session',
				1,
				outerOptions.title ?? '',
			),
		} as SessionUpdate,
		fixtureStart + 200,
	);
	state = apply(state, childThoughtEvent(nestedOptions), fixtureStart + 300);
	state = apply(state, childToolEvent(nestedOptions), fixtureStart + 500);
	state = apply(
		state,
		{
			sessionUpdate: 'tool_call_update',
			toolCallId: 'outer-child:nested-parent-call',
			status: 'completed',
			rawOutput: { metadata: { sessionID: 'nested-child' } },
			_meta: childMeta(
				'outer-child',
				'root-session',
				1,
				outerOptions.title ?? '',
			),
		} as SessionUpdate,
		fixtureStart + 700,
	);
	const display = toDisplayState(state);
	return { display, children: display.children };
}
