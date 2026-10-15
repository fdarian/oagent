import type {
	SessionUpdate,
	ToolCallContent,
	ToolCallLocation,
	ToolKind,
} from '@oagent/engine';
import { stripChildTitlePrefix } from './subagent-title';

export type TimelineToolPart = {
	kind: 'tool';
	id: string;
	toolCallId: string;
	toolName: string;
	title: string;
	state:
		| 'input-streaming'
		| 'input-available'
		| 'output-available'
		| 'output-error';
	toolKind?: ToolKind;
	content: ToolCallContent[];
	locations: ToolCallLocation[];
	rawInput?: unknown;
	rawOutput?: unknown;
	childSessionId?: string;
	createdAt: number;
	durationMs?: number;
};

export type TimelinePart =
	| { kind: 'text'; id: string; text: string; createdAt: number }
	| { kind: 'steer'; id: string; text: string; createdAt: number }
	| { kind: 'user'; id: string; text: string; createdAt: number }
	| {
			kind: 'reasoning';
			id: string;
			text: string;
			isStreaming: boolean;
			createdAt: number;
			durationMs?: number;
	  }
	| TimelineToolPart
	| {
			kind: 'error';
			id: string;
			message: string;
			code?: string;
			createdAt: number;
	  };

export type ChildSessionStatus = 'running' | 'completed' | 'failed';

export type ChildTimeline = {
	id: string;
	parentId: string;
	depth: number;
	title: string;
	parts: TimelinePart[];
	streamingTail: TimelinePart | null;
	status: ChildSessionStatus;
	startedAt: number;
	endedAt?: number;
	lastActivity: string;
	lastStatus?: string;
	agentName?: string;
	description?: string;
};

export type AdapterResult = {
	parts: TimelinePart[];
	lastStatus?: string;
	children: Map<string, ChildTimeline>;
};

export type DisplayState = {
	parts: TimelinePart[];
	streamingTail: TimelinePart | null;
	lastStatus?: string;
	children: Map<string, ChildTimeline>;
};

function makeId(prefix: string, counter: number): string {
	return `${prefix}-${counter}`;
}

function mapToolState(
	status?: string | null,
): 'input-streaming' | 'input-available' | 'output-available' | 'output-error' {
	switch (status) {
		case 'pending':
			return 'input-streaming';
		case 'in_progress':
			return 'input-available';
		case 'completed':
			return 'output-available';
		case 'failed':
			return 'output-error';
		default:
			return 'input-streaming';
	}
}

type OpenText = {
	kind: 'text';
	id: string;
	text: string;
	createdAt: number;
	messageId?: string | null;
};

type OpenSteer = {
	kind: 'steer';
	id: string;
	text: string;
	createdAt: number;
	messageId?: string | null;
};

type OpenReasoning = {
	kind: 'reasoning';
	id: string;
	text: string;
	isStreaming: boolean;
	createdAt: number;
	messageId?: string | null;
};

type UserMessageChunk = Extract<
	SessionUpdate,
	{ sessionUpdate: 'user_message_chunk' }
>;

function isSteerMessageChunk(event: SessionUpdate): event is UserMessageChunk {
	return (
		event.sessionUpdate === 'user_message_chunk' &&
		event._meta?.['oagent/steer'] === true
	);
}

function shouldContinueAccumulating(
	openPart: { messageId?: string | null } | null,
	chunkMessageId: string | null | undefined,
): boolean {
	if (openPart === null) return false;
	const openId = openPart.messageId;
	if (
		openId !== null &&
		openId !== undefined &&
		chunkMessageId !== null &&
		chunkMessageId !== undefined
	) {
		return openId === chunkMessageId;
	}
	return true;
}

type TimelineReduceState = {
	parts: TimelinePart[];
	openText: OpenText | null;
	openSteer: OpenSteer | null;
	openReasoning: OpenReasoning | null;
	toolIndices: Map<string, number>;
	idCounter: number;
	runningToolId: string | undefined;
	runningToolTitle: string | undefined;
};

type ChildReduceState = {
	id: string;
	/**
	 * `session` children are announced by the harness; `tool-call` ones are
	 * synthesized from a Claude Agent tool call; `native` ones come from
	 * `subagent_update` events carrying `oagent/subagent` metadata.
	 */
	origin: 'session' | 'tool-call' | 'native';
	parentId: string;
	depth: number;
	title: string;
	timeline: TimelineReduceState;
	status: ChildSessionStatus;
	startedAt: number;
	lastEventAt: number;
	endedAt?: number;
	lastActivity: string;
	agentName?: string;
	description?: string;
};

export type ReduceState = {
	timeline: TimelineReduceState;
	children: Map<string, ChildReduceState>;
};

function createInitialTimelineState(): TimelineReduceState {
	return {
		parts: [],
		openText: null,
		openSteer: null,
		openReasoning: null,
		toolIndices: new Map(),
		idCounter: 0,
		runningToolId: undefined,
		runningToolTitle: undefined,
	};
}

export function createInitialState(): ReduceState {
	return {
		timeline: createInitialTimelineState(),
		children: new Map(),
	};
}

function flushOpenText(state: TimelineReduceState): TimelineReduceState {
	if (state.openText === null) return state;
	return {
		...state,
		parts: [
			...state.parts,
			{
				kind: 'text',
				id: state.openText.id,
				text: state.openText.text,
				createdAt: state.openText.createdAt,
			},
		],
		openText: null,
	};
}

function flushOpenSteer(state: TimelineReduceState): TimelineReduceState {
	if (state.openSteer === null) return state;
	return {
		...state,
		parts: [
			...state.parts,
			{
				kind: 'steer',
				id: state.openSteer.id,
				text: state.openSteer.text,
				createdAt: state.openSteer.createdAt,
			},
		],
		openSteer: null,
	};
}

function flushOpenReasoning(
	state: TimelineReduceState,
	createdAt: number,
): TimelineReduceState {
	if (state.openReasoning === null) return state;
	const durationMs = createdAt - state.openReasoning.createdAt;
	return {
		...state,
		parts: [
			...state.parts,
			{
				kind: 'reasoning',
				id: state.openReasoning.id,
				text: state.openReasoning.text,
				isStreaming: false,
				createdAt: state.openReasoning.createdAt,
				durationMs,
			},
		],
		openReasoning: null,
	};
}

function isRunningToolState(
	state:
		| 'input-streaming'
		| 'input-available'
		| 'output-available'
		| 'output-error',
): boolean {
	return state === 'input-streaming' || state === 'input-available';
}

function applyTimelineEvent(
	state: TimelineReduceState,
	event: SessionUpdate,
	createdAt: number,
): TimelineReduceState {
	const isSteerChunk = isSteerMessageChunk(event);
	const isAccumulatingChunk =
		event.sessionUpdate === 'agent_message_chunk' ||
		event.sessionUpdate === 'agent_thought_chunk' ||
		isSteerChunk;

	let nextState = state;

	if (!isAccumulatingChunk) {
		nextState = flushOpenText(nextState);
		nextState = flushOpenSteer(nextState);
		nextState = flushOpenReasoning(nextState, createdAt);
	}

	if (event.sessionUpdate === 'user_message_chunk' && !isSteerChunk) {
		return nextState;
	}

	if (event.sessionUpdate === 'agent_message_chunk') {
		const chunkMessageId = event.messageId;
		const contentBlock = event.content;
		const chunkText =
			contentBlock.type === 'text' ? contentBlock.text : undefined;

		// Flush reasoning if open (different kind of chunk)
		nextState = flushOpenReasoning(nextState, createdAt);
		nextState = flushOpenSteer(nextState);

		const shouldContinue = shouldContinueAccumulating(
			nextState.openText,
			chunkMessageId,
		);
		if (!shouldContinue && nextState.openText !== null) {
			nextState = flushOpenText(nextState);
		}

		if (chunkText !== undefined) {
			if (nextState.openText === null) {
				nextState = {
					...nextState,
					openText: {
						kind: 'text',
						id: makeId('text', nextState.idCounter),
						text: chunkText,
						createdAt,
						messageId: chunkMessageId,
					},
					idCounter: nextState.idCounter + 1,
				};
			} else {
				nextState = {
					...nextState,
					openText: {
						kind: 'text',
						id: nextState.openText.id,
						text: nextState.openText.text + chunkText,
						createdAt: nextState.openText.createdAt,
						messageId: chunkMessageId,
					},
				};
			}
		} else if (nextState.openText !== null) {
			nextState = {
				...nextState,
				openText: {
					kind: 'text',
					id: nextState.openText.id,
					text: nextState.openText.text,
					createdAt: nextState.openText.createdAt,
					messageId: chunkMessageId,
				},
			};
		}

		return nextState;
	}

	if (event.sessionUpdate === 'agent_thought_chunk') {
		const chunkMessageId = event.messageId;
		const contentBlock = event.content;
		const chunkText =
			contentBlock.type === 'text' ? contentBlock.text : undefined;

		// Flush text if open (different kind of chunk)
		nextState = flushOpenText(nextState);
		nextState = flushOpenSteer(nextState);

		const shouldContinue = shouldContinueAccumulating(
			nextState.openReasoning,
			chunkMessageId,
		);
		if (!shouldContinue && nextState.openReasoning !== null) {
			nextState = flushOpenReasoning(nextState, createdAt);
		}

		if (chunkText !== undefined) {
			if (nextState.openReasoning === null) {
				nextState = {
					...nextState,
					openReasoning: {
						kind: 'reasoning',
						id: makeId('reasoning', nextState.idCounter),
						text: chunkText,
						isStreaming: true,
						createdAt,
						messageId: chunkMessageId,
					},
					idCounter: nextState.idCounter + 1,
				};
			} else {
				nextState = {
					...nextState,
					openReasoning: {
						kind: 'reasoning',
						id: nextState.openReasoning.id,
						text: nextState.openReasoning.text + chunkText,
						isStreaming: nextState.openReasoning.isStreaming,
						createdAt: nextState.openReasoning.createdAt,
						messageId: chunkMessageId,
					},
				};
			}
		} else if (nextState.openReasoning !== null) {
			nextState = {
				...nextState,
				openReasoning: {
					kind: 'reasoning',
					id: nextState.openReasoning.id,
					text: nextState.openReasoning.text,
					isStreaming: nextState.openReasoning.isStreaming,
					createdAt: nextState.openReasoning.createdAt,
					messageId: chunkMessageId,
				},
			};
		}

		return nextState;
	}

	if (isSteerChunk) {
		const chunkMessageId = event.messageId;
		const contentBlock = event.content;
		const chunkText =
			contentBlock.type === 'text' ? contentBlock.text : undefined;

		nextState = flushOpenText(nextState);
		nextState = flushOpenReasoning(nextState, createdAt);

		const shouldContinue = shouldContinueAccumulating(
			nextState.openSteer,
			chunkMessageId,
		);
		if (!shouldContinue && nextState.openSteer !== null) {
			nextState = flushOpenSteer(nextState);
		}

		if (chunkText !== undefined) {
			if (nextState.openSteer === null) {
				nextState = {
					...nextState,
					openSteer: {
						kind: 'steer',
						id: makeId('steer', nextState.idCounter),
						text: chunkText,
						createdAt,
						messageId: chunkMessageId,
					},
					idCounter: nextState.idCounter + 1,
				};
			} else {
				nextState = {
					...nextState,
					openSteer: {
						kind: 'steer',
						id: nextState.openSteer.id,
						text: nextState.openSteer.text + chunkText,
						createdAt: nextState.openSteer.createdAt,
						messageId: chunkMessageId,
					},
				};
			}
		} else if (nextState.openSteer !== null) {
			nextState = {
				...nextState,
				openSteer: {
					kind: 'steer',
					id: nextState.openSteer.id,
					text: nextState.openSteer.text,
					createdAt: nextState.openSteer.createdAt,
					messageId: chunkMessageId,
				},
			};
		}

		return nextState;
	}

	if (event.sessionUpdate === 'tool_call') {
		const toolCallId = event.toolCallId;
		const existingIndex = nextState.toolIndices.get(toolCallId);
		const newState = mapToolState(event.status);
		if (existingIndex === undefined) {
			const toolIndices = new Map(nextState.toolIndices);
			toolIndices.set(toolCallId, nextState.parts.length);
			const isRunning = isRunningToolState(newState);
			return {
				...nextState,
				toolIndices,
				parts: [
					...nextState.parts,
					{
						kind: 'tool',
						id: `tool-${toolCallId}`,
						toolCallId,
						toolName: event.title,
						title: event.title,
						state: newState,
						toolKind: event.kind ?? undefined,
						content: event.content ?? [],
						locations: event.locations ?? [],
						rawInput: event.rawInput,
						rawOutput: event.rawOutput,
						createdAt,
					},
				],
				runningToolId: isRunning ? toolCallId : nextState.runningToolId,
				runningToolTitle: isRunning ? event.title : nextState.runningToolTitle,
			};
		}
		const existing = nextState.parts[existingIndex];
		if (existing === undefined || existing.kind !== 'tool') return nextState;
		const durationMs =
			(newState === 'output-available' || newState === 'output-error') &&
			existing.durationMs === undefined
				? createdAt - existing.createdAt
				: existing.durationMs;
		const nextParts = [...nextState.parts];
		nextParts[existingIndex] = {
			kind: 'tool',
			id: existing.id,
			toolCallId: existing.toolCallId,
			toolName: existing.toolName,
			title: event.title,
			state: newState,
			toolKind: event.kind ?? existing.toolKind,
			content:
				event.content !== null &&
				event.content !== undefined &&
				event.content.length > 0
					? event.content
					: existing.content,
			locations: event.locations ?? existing.locations,
			rawInput: event.rawInput ?? existing.rawInput,
			rawOutput: event.rawOutput ?? existing.rawOutput,
			childSessionId: existing.childSessionId,
			createdAt: existing.createdAt,
			durationMs,
		};
		const isRunning = isRunningToolState(newState);
		const wasRunning =
			nextState.runningToolId === toolCallId && !isRunning
				? {
						runningToolId: undefined as string | undefined,
						runningToolTitle: undefined as string | undefined,
					}
				: null;
		if (wasRunning !== null) {
			return {
				...nextState,
				parts: nextParts,
				runningToolId: wasRunning.runningToolId,
				runningToolTitle: wasRunning.runningToolTitle,
			};
		}
		if (isRunning) {
			return {
				...nextState,
				parts: nextParts,
				runningToolId: toolCallId,
				runningToolTitle: event.title,
			};
		}
		return {
			...nextState,
			parts: nextParts,
		};
	}

	if (event.sessionUpdate === 'tool_call_update') {
		const toolCallId = event.toolCallId;
		const existingIndex = nextState.toolIndices.get(toolCallId);
		if (existingIndex === undefined) return nextState;
		const existing = nextState.parts[existingIndex];
		if (existing === undefined || existing.kind !== 'tool') return nextState;
		const nextTitle =
			event.title !== null && event.title !== undefined
				? event.title
				: existing.title;
		const nextState_ =
			event.status !== null && event.status !== undefined
				? mapToolState(event.status)
				: existing.state;
		const nextToolKind =
			event.kind !== null && event.kind !== undefined
				? event.kind
				: existing.toolKind;
		const nextContent =
			event.content !== null &&
			event.content !== undefined &&
			event.content.length > 0
				? event.content
				: existing.content;
		const nextLocations =
			event.locations !== null && event.locations !== undefined
				? event.locations
				: existing.locations;
		const nextRawInput =
			event.rawInput !== null && event.rawInput !== undefined
				? event.rawInput
				: existing.rawInput;
		const nextRawOutput =
			event.rawOutput !== null && event.rawOutput !== undefined
				? event.rawOutput
				: existing.rawOutput;
		const durationMs =
			(nextState_ === 'output-available' || nextState_ === 'output-error') &&
			existing.durationMs === undefined
				? createdAt - existing.createdAt
				: existing.durationMs;
		const nextParts = [...nextState.parts];
		nextParts[existingIndex] = {
			kind: 'tool',
			id: existing.id,
			toolCallId: existing.toolCallId,
			toolName: existing.toolName,
			title: nextTitle,
			state: nextState_,
			toolKind: nextToolKind,
			content: nextContent,
			locations: nextLocations,
			rawInput: nextRawInput,
			rawOutput: nextRawOutput,
			childSessionId: existing.childSessionId,
			createdAt: existing.createdAt,
			durationMs,
		};
		const isRunning = isRunningToolState(nextState_);
		const wasRunning =
			nextState.runningToolId === toolCallId && !isRunning
				? {
						runningToolId: undefined as string | undefined,
						runningToolTitle: undefined as string | undefined,
					}
				: null;
		if (wasRunning !== null) {
			return {
				...nextState,
				parts: nextParts,
				runningToolId: wasRunning.runningToolId,
				runningToolTitle: wasRunning.runningToolTitle,
			};
		}
		if (isRunning) {
			return {
				...nextState,
				parts: nextParts,
				runningToolId: toolCallId,
				runningToolTitle: nextTitle,
			};
		}
		return {
			...nextState,
			parts: nextParts,
		};
	}

	// Ignored variants: plan, plan_update, plan_removed, available_commands_update,
	// current_mode_update, config_option_update, session_info_update, usage_update,
	// compaction_update, compaction_summary_chunk, notice, session_message,
	// session_message_chunk. `subagent_update` is consumed by applyEvent when it
	// carries `oagent/subagent` metadata and ignored here otherwise.
	// Open text/reasoning already flushed above.
	return nextState;
}

type ChildSessionMeta = {
	id: string;
	parentId: string;
	depth: number;
	title: string;
};

export type SubagentToolDetails = {
	agentName?: string;
	description?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readString(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const property = value[key];
	return typeof property === 'string' ? property : undefined;
}

function readBoolean(value: unknown, key: string): boolean | undefined {
	if (!isRecord(value)) return undefined;
	const property = value[key];
	return typeof property === 'boolean' ? property : undefined;
}

/** Id of the root timeline, which is not itself a child session. */
const ROOT_TIMELINE_ID = 'root';

/** Reads the Agent tool call a Claude subagent's event belongs to. */
function readClaudeParentToolUseId(event: SessionUpdate): string | undefined {
	if (!('_meta' in event) || !isRecord(event._meta)) return undefined;
	const parentToolUseId = readString(event._meta.claudeCode, 'parentToolUseId');
	if (parentToolUseId === undefined) return undefined;
	// An Agent call's own progress updates name themselves as parent.
	if ('toolCallId' in event && event.toolCallId === parentToolUseId) {
		return undefined;
	}
	return parentToolUseId;
}

function readNestedString(
	value: unknown,
	parentKey: string,
	key: string,
): string | undefined {
	if (!isRecord(value)) return undefined;
	return readString(value[parentKey], key);
}

function readChildSessionMeta(
	event: SessionUpdate,
): ChildSessionMeta | undefined {
	if (!('_meta' in event) || !isRecord(event._meta)) return undefined;
	const value = event._meta['opencode/child-session'];
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		throw new Error('Invalid opencode child-session metadata');
	}

	const id = value.id;
	const parentId = value.parentID;
	const depth = value.depth;
	const title = value.title;
	if (
		typeof id !== 'string' ||
		typeof parentId !== 'string' ||
		typeof depth !== 'number' ||
		!Number.isInteger(depth) ||
		typeof title !== 'string'
	) {
		throw new Error('Invalid opencode child-session metadata fields');
	}

	return { id, parentId, depth, title };
}

export function isSubagentToolPart(part: TimelineToolPart): boolean {
	const toolName = part.toolName.toLowerCase();
	const title = part.title.toLowerCase();
	if (toolName === 'subagent' || title === 'subagent') return true;
	return (
		(toolName === 'task' || title === 'task') &&
		readString(part.rawInput, 'subagent_type') !== undefined
	);
}

export function getSubagentToolDetails(
	part: TimelineToolPart,
): SubagentToolDetails {
	const agent = readString(part.rawInput, 'agent');
	const legacyAgent = readString(part.rawInput, 'subagent_type');
	return {
		agentName: agent !== undefined ? agent : legacyAgent,
		description: readString(part.rawInput, 'description'),
	};
}

function authoritativeChildSessionId(
	part: TimelineToolPart,
	children: ReadonlyMap<string, ChildReduceState>,
): string | undefined {
	const origin = children.get(part.toolCallId)?.origin;
	if (origin === 'tool-call' || origin === 'native') {
		return part.toolCallId;
	}
	const sessionId = readNestedString(part.rawOutput, 'metadata', 'sessionID');
	if (sessionId !== undefined) return sessionId;
	const legacySessionId = readNestedString(
		part.rawOutput,
		'metadata',
		'sessionId',
	);
	if (legacySessionId !== undefined) return legacySessionId;
	return readString(part.rawInput, 'sessionID');
}

function findUnlinkedChildSessionByDescription(
	children: ReadonlyMap<string, ChildReduceState>,
	claimedChildIds: ReadonlySet<string>,
	description: string | undefined,
	parentTimelineId: string | undefined,
): string | undefined {
	if (description === undefined) return undefined;

	for (const child of children.values()) {
		const belongsToTimeline =
			parentTimelineId === undefined
				? child.depth === 1
				: child.parentId === parentTimelineId;
		if (
			child.origin === 'session' &&
			belongsToTimeline &&
			child.title === description &&
			!claimedChildIds.has(child.id)
		) {
			return child.id;
		}
	}

	for (const child of children.values()) {
		if (
			child.origin === 'session' &&
			child.title === description &&
			!claimedChildIds.has(child.id)
		) {
			return child.id;
		}
	}

	return undefined;
}

function childStatusForTool(part: TimelineToolPart): ChildSessionStatus {
	if (part.state === 'output-error') return 'failed';
	if (
		part.state === 'output-available' &&
		readBoolean(part.rawInput, 'background') !== true &&
		readBoolean(part.rawInput, 'run_in_background') !== true
	) {
		return 'completed';
	}
	return 'running';
}

type ChildTiming = {
	startedAt: number;
	endedAt: number | undefined;
};

function timingForTool(
	child: ChildReduceState,
	part: TimelineToolPart,
	status: ChildSessionStatus,
	createdAt: number,
): ChildTiming {
	if (status === 'running') {
		return { startedAt: child.startedAt, endedAt: undefined };
	}

	if (child.lastEventAt > child.startedAt) {
		return { startedAt: child.startedAt, endedAt: child.lastEventAt };
	}

	if (part.durationMs !== undefined && part.durationMs > 0) {
		return {
			startedAt: part.createdAt,
			endedAt: part.createdAt + part.durationMs,
		};
	}

	return { startedAt: child.startedAt, endedAt: createdAt };
}

function updateChildFromTool(
	child: ChildReduceState,
	part: TimelineToolPart,
	details: SubagentToolDetails,
	createdAt: number,
): ChildReduceState {
	const status = childStatusForTool(part);
	const timing = timingForTool(child, part, status, createdAt);
	return {
		...child,
		status,
		startedAt: timing.startedAt,
		endedAt: timing.endedAt,
		agentName:
			details.agentName !== undefined ? details.agentName : child.agentName,
		description:
			details.description !== undefined
				? details.description
				: child.description,
	};
}

type TimelineOwner = {
	childId?: string;
	timeline: TimelineReduceState;
};

function reconcileSubagentLinks(
	state: ReduceState,
	createdAt: number,
): ReduceState {
	const children = new Map(state.children);
	const owners: TimelineOwner[] = [{ timeline: state.timeline }];
	for (const child of state.children.values()) {
		owners.push({ childId: child.id, timeline: child.timeline });
	}

	const claimedChildIds = new Set<string>();
	let rootTimeline = state.timeline;

	for (const owner of owners) {
		let changed = false;
		const parts = owner.timeline.parts.map((part) => {
			if (part.kind !== 'tool' || !isSubagentToolPart(part)) return part;

			const details = getSubagentToolDetails(part);
			const authoritativeId = authoritativeChildSessionId(part, children);
			const fallbackId = findUnlinkedChildSessionByDescription(
				children,
				claimedChildIds,
				details.description,
				owner.childId,
			);
			const linkedId =
				authoritativeId !== undefined
					? authoritativeId
					: part.childSessionId !== undefined
						? part.childSessionId
						: fallbackId;
			if (linkedId === undefined) return part;

			claimedChildIds.add(linkedId);
			const child = children.get(linkedId);
			// Native children report their own state; the synthetic part follows them.
			if (child !== undefined && child.origin !== 'native') {
				children.set(
					linkedId,
					updateChildFromTool(child, part, details, createdAt),
				);
			}

			if (part.childSessionId === linkedId) return part;
			changed = true;
			return { ...part, childSessionId: linkedId };
		});

		if (!changed) continue;
		const timeline = { ...owner.timeline, parts };
		if (owner.childId === undefined) {
			rootTimeline = timeline;
			continue;
		}
		const child = children.get(owner.childId);
		if (child !== undefined) {
			children.set(owner.childId, { ...child, timeline });
		}
	}

	return { timeline: rootTimeline, children };
}

function compactActivityText(prefix: string, text: string): string {
	const compact = text.replace(/\s+/g, ' ').trim();
	if (compact.length === 0) return prefix;
	const limit = 72;
	return compact.length <= limit
		? `${prefix}: ${compact}`
		: `${prefix}: ${compact.slice(0, limit - 1)}…`;
}

function activityForChildEvent(
	event: SessionUpdate,
	timeline: TimelineReduceState,
	previousActivity: string | undefined,
): string {
	if (event.sessionUpdate === 'agent_message_chunk') {
		const text = timeline.openText?.text;
		return text === undefined
			? previousActivity === undefined
				? 'Writing a response'
				: previousActivity
			: compactActivityText('Message', text);
	}
	if (event.sessionUpdate === 'agent_thought_chunk') {
		const text = timeline.openReasoning?.text;
		return text === undefined
			? previousActivity === undefined
				? 'Reasoning'
				: previousActivity
			: compactActivityText('Reasoning', text);
	}
	if (
		event.sessionUpdate === 'tool_call' ||
		event.sessionUpdate === 'tool_call_update'
	) {
		const index = timeline.toolIndices.get(event.toolCallId);
		const part = index === undefined ? undefined : timeline.parts[index];
		if (part !== undefined && part.kind === 'tool' && part.title.length > 0) {
			return part.title;
		}
	}
	if (previousActivity !== undefined) return previousActivity;
	return 'Starting';
}

type ChildRoute = {
	meta: ChildSessionMeta;
	origin: ChildReduceState['origin'];
};

type NativeSubagentMeta = {
	sessionId: string;
	/** `null` when the root session spawned the subagent. */
	parentSessionId: string | null;
};

/** Reads the engine's `oagent/subagent` tag on native Claude subagent events. */
function readNativeSubagentMeta(
	event: SessionUpdate,
): NativeSubagentMeta | undefined {
	if (!('_meta' in event) || !isRecord(event._meta)) return undefined;
	const value = event._meta['oagent/subagent'];
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		throw new Error('Invalid oagent subagent metadata');
	}
	const sessionId = value.sessionId;
	const parentSessionId = value.parentSessionId;
	if (
		typeof sessionId !== 'string' ||
		(parentSessionId !== null && typeof parentSessionId !== 'string')
	) {
		throw new Error('Invalid oagent subagent metadata fields');
	}
	return { sessionId, parentSessionId };
}

function resolveNativeParent(
	state: ReduceState,
	meta: NativeSubagentMeta,
): { parentId: string; depth: number } {
	if (meta.parentSessionId === null) {
		return { parentId: ROOT_TIMELINE_ID, depth: 1 };
	}
	const parent = state.children.get(meta.parentSessionId);
	if (parent === undefined) {
		throw new Error(
			`Native subagent ${meta.sessionId} references unknown parent ${meta.parentSessionId}`,
		);
	}
	return { parentId: parent.id, depth: parent.depth + 1 };
}

function resolveNativeRoute(
	state: ReduceState,
	meta: NativeSubagentMeta,
): ChildRoute {
	const existing = state.children.get(meta.sessionId);
	if (existing === undefined) {
		throw new Error(`Event for unknown native subagent ${meta.sessionId}`);
	}
	return {
		meta: {
			id: existing.id,
			parentId: existing.parentId,
			depth: existing.depth,
			title: existing.title,
		},
		origin: 'native',
	};
}

type SubagentUpdateEvent = Extract<
	SessionUpdate,
	{ sessionUpdate: 'subagent_update' }
>;

function nativeStatusFromState(
	state: SubagentUpdateEvent['state'],
	current: ChildSessionStatus,
): ChildSessionStatus {
	if (state === undefined || state === null) return current;
	switch (state.state) {
		case 'running':
			return 'running';
		case 'completed':
		case 'idle':
			return 'completed';
		case 'failed':
		case 'cancelled':
		case 'disconnected':
			return 'failed';
		default:
			return current;
	}
}

function toolStateForChildStatus(
	status: ChildSessionStatus,
): TimelineToolPart['state'] {
	switch (status) {
		case 'running':
			return 'input-available';
		case 'completed':
			return 'output-available';
		case 'failed':
			return 'output-error';
	}
}

/**
 * Keeps the synthetic Agent card in the parent timeline in step with a native
 * child. The adapter drops the parent's real Agent tool call in native mode.
 */
function withNativeToolPart(
	timeline: TimelineReduceState,
	child: ChildReduceState,
	createdAt: number,
): TimelineReduceState {
	const toolState = toolStateForChildStatus(child.status);
	const index = timeline.toolIndices.get(child.id);
	if (index === undefined) {
		const flushed = flushOpenReasoning(
			flushOpenSteer(flushOpenText(timeline)),
			createdAt,
		);
		const toolIndices = new Map(flushed.toolIndices);
		toolIndices.set(child.id, flushed.parts.length);
		return {
			...flushed,
			toolIndices,
			parts: [
				...flushed.parts,
				{
					kind: 'tool',
					id: `tool-${child.id}`,
					toolCallId: child.id,
					toolName: 'subagent',
					title: 'Subagent',
					state: toolState,
					content: [],
					locations: [],
					childSessionId: child.id,
					createdAt: child.startedAt,
					durationMs:
						child.endedAt === undefined
							? undefined
							: child.endedAt - child.startedAt,
				},
			],
		};
	}
	const existing = timeline.parts[index];
	if (existing === undefined || existing.kind !== 'tool') return timeline;
	if (existing.state === toolState) return timeline;
	const parts = [...timeline.parts];
	parts[index] = {
		...existing,
		state: toolState,
		durationMs:
			child.endedAt === undefined
				? undefined
				: child.endedAt - existing.createdAt,
	};
	return { ...timeline, parts };
}

function applyNativeSubagentUpdate(
	state: ReduceState,
	event: SubagentUpdateEvent,
	meta: NativeSubagentMeta,
	createdAt: number,
): ReduceState {
	const existing = state.children.get(meta.sessionId);
	const placement =
		existing === undefined
			? resolveNativeParent(state, meta)
			: { parentId: existing.parentId, depth: existing.depth };

	const status = nativeStatusFromState(
		event.state,
		existing === undefined ? 'running' : existing.status,
	);
	const endedAt =
		status === 'running'
			? undefined
			: existing?.endedAt !== undefined
				? existing.endedAt
				: createdAt;
	const description =
		event.description === undefined
			? existing?.description
			: event.description === null
				? undefined
				: event.description;
	const title =
		event.title !== undefined && event.title !== null
			? event.title
			: existing !== undefined
				? existing.title
				: description !== undefined
					? description
					: meta.sessionId;

	const child: ChildReduceState = {
		id: meta.sessionId,
		origin: 'native',
		parentId: placement.parentId,
		depth: placement.depth,
		title,
		timeline:
			existing === undefined ? createInitialTimelineState() : existing.timeline,
		status,
		startedAt: existing === undefined ? createdAt : existing.startedAt,
		lastEventAt: createdAt,
		endedAt,
		lastActivity: existing === undefined ? 'Starting' : existing.lastActivity,
		description,
	};

	const children = new Map(state.children);
	children.set(child.id, child);
	let timeline = state.timeline;
	if (child.parentId === ROOT_TIMELINE_ID) {
		timeline = withNativeToolPart(timeline, child, createdAt);
	} else {
		const parent = children.get(child.parentId);
		if (parent !== undefined) {
			children.set(parent.id, {
				...parent,
				timeline: withNativeToolPart(parent.timeline, child, createdAt),
			});
		}
	}
	return reconcileSubagentLinks({ timeline, children }, createdAt);
}

function findToolPartOwner(
	state: ReduceState,
	toolCallId: string,
): { part: TimelineToolPart; parentId: string; depth: number } | undefined {
	const rootIndex = state.timeline.toolIndices.get(toolCallId);
	const rootPart =
		rootIndex === undefined ? undefined : state.timeline.parts[rootIndex];
	if (rootPart !== undefined && rootPart.kind === 'tool') {
		return { part: rootPart, parentId: ROOT_TIMELINE_ID, depth: 0 };
	}
	for (const child of state.children.values()) {
		const index = child.timeline.toolIndices.get(toolCallId);
		const part = index === undefined ? undefined : child.timeline.parts[index];
		if (part !== undefined && part.kind === 'tool') {
			return { part, parentId: child.id, depth: child.depth };
		}
	}
	return undefined;
}

function resolveChildRoute(
	state: ReduceState,
	event: SessionUpdate,
): ChildRoute | undefined {
	const childMeta = readChildSessionMeta(event);
	if (childMeta !== undefined) return { meta: childMeta, origin: 'session' };

	const nativeMeta = readNativeSubagentMeta(event);
	if (nativeMeta !== undefined) return resolveNativeRoute(state, nativeMeta);

	const parentToolUseId = readClaudeParentToolUseId(event);
	if (parentToolUseId === undefined) return undefined;
	const existing = state.children.get(parentToolUseId);
	if (existing !== undefined) {
		return {
			meta: {
				id: existing.id,
				parentId: existing.parentId,
				depth: existing.depth,
				title: existing.title,
			},
			origin: existing.origin,
		};
	}
	// Without the Agent call there is no timeline to open, so the event stays inline.
	const owner = findToolPartOwner(state, parentToolUseId);
	if (owner === undefined) return undefined;
	const description = getSubagentToolDetails(owner.part).description;
	return {
		meta: {
			id: parentToolUseId,
			parentId: owner.parentId,
			depth: owner.depth + 1,
			title: description === undefined ? owner.part.title : description,
		},
		origin: 'tool-call',
	};
}

export function applyEvent(
	state: ReduceState,
	event: SessionUpdate,
	createdAt: number,
): ReduceState {
	if (event.sessionUpdate === 'subagent_update') {
		const nativeMeta = readNativeSubagentMeta(event);
		if (nativeMeta !== undefined) {
			return applyNativeSubagentUpdate(state, event, nativeMeta, createdAt);
		}
	}

	const route = resolveChildRoute(state, event);
	if (route === undefined) {
		return reconcileSubagentLinks(
			{
				timeline: applyTimelineEvent(state.timeline, event, createdAt),
				children: state.children,
			},
			createdAt,
		);
	}

	const childMeta = route.meta;
	const existingChild = state.children.get(childMeta.id);
	const previousTimeline =
		existingChild === undefined
			? createInitialTimelineState()
			: existingChild.timeline;
	const timeline = applyTimelineEvent(previousTimeline, event, createdAt);
	const child: ChildReduceState = {
		id: childMeta.id,
		origin: route.origin,
		parentId: childMeta.parentId,
		depth: childMeta.depth,
		title: childMeta.title,
		timeline,
		status: existingChild === undefined ? 'running' : existingChild.status,
		startedAt:
			existingChild === undefined ? createdAt : existingChild.startedAt,
		lastEventAt: createdAt,
		endedAt: existingChild?.endedAt,
		lastActivity: activityForChildEvent(
			event,
			timeline,
			existingChild?.lastActivity,
		),
		agentName: existingChild?.agentName,
		description: existingChild?.description,
	};
	const children = new Map(state.children);
	children.set(child.id, child);
	return reconcileSubagentLinks(
		{ timeline: state.timeline, children },
		createdAt,
	);
}

type TimelineDisplay = {
	parts: TimelinePart[];
	streamingTail: TimelinePart | null;
	lastStatus?: string;
};

function lastStatusForTimeline(
	state: TimelineReduceState,
	childTitle: string | undefined,
	childDescription: string | undefined,
): string | undefined {
	if (state.runningToolTitle === undefined) return undefined;
	const title =
		childTitle === undefined
			? state.runningToolTitle
			: stripChildTitlePrefix(
					state.runningToolTitle,
					childTitle,
					childDescription,
				);
	return `Running tool: ${title}`;
}

function toTimelineDisplay(
	state: TimelineReduceState,
	childTitle?: string,
	childDescription?: string,
): TimelineDisplay {
	const streamingTail: TimelinePart | null =
		state.openText !== null
			? {
					kind: 'text',
					id: state.openText.id,
					text: state.openText.text,
					createdAt: state.openText.createdAt,
				}
			: state.openSteer !== null
				? {
						kind: 'steer',
						id: state.openSteer.id,
						text: state.openSteer.text,
						createdAt: state.openSteer.createdAt,
					}
				: state.openReasoning !== null
					? {
							kind: 'reasoning',
							id: state.openReasoning.id,
							text: state.openReasoning.text,
							isStreaming: true,
							createdAt: state.openReasoning.createdAt,
						}
					: null;

	return {
		parts: state.parts,
		streamingTail,
		lastStatus: lastStatusForTimeline(state, childTitle, childDescription),
	};
}

function toChildTimeline(
	child: ChildReduceState,
	timeline: TimelineDisplay,
): ChildTimeline {
	return {
		id: child.id,
		parentId: child.parentId,
		depth: child.depth,
		title: child.title,
		parts: timeline.parts,
		streamingTail: timeline.streamingTail,
		status: child.status,
		startedAt: child.startedAt,
		endedAt: child.endedAt,
		lastActivity: child.lastActivity,
		lastStatus: timeline.lastStatus,
		agentName: child.agentName,
		description: child.description,
	};
}

function finalizeTimeline(
	state: TimelineReduceState,
	createdAt: number,
	childTitle?: string,
	childDescription?: string,
): TimelineDisplay {
	const withText = flushOpenText(state);
	const withSteer = flushOpenSteer(withText);
	const finalized = flushOpenReasoning(withSteer, createdAt);
	return {
		parts: finalized.parts,
		streamingTail: null,
		lastStatus: lastStatusForTimeline(state, childTitle, childDescription),
	};
}

/**
 * A background Claude subagent launched through the Agent tool call has no
 * completion event, but the adapter holds its turn open until the subagent
 * settles, so a launched one is done by the time the job terminates. Native
 * subagents are treated the same way when their final state update never
 * arrives.
 */
function settledOnTermination(
	state: ReduceState,
	child: ChildReduceState,
): ChildSessionStatus {
	if (child.origin === 'native') return 'completed';
	if (child.origin !== 'tool-call') return 'failed';
	const owner = findToolPartOwner(state, child.id);
	return owner !== undefined && owner.part.state === 'output-available'
		? 'completed'
		: 'failed';
}

export function finalizeState(
	state: ReduceState,
	finalizedAt: number = Date.now(),
): AdapterResult {
	const timeline = finalizeTimeline(state.timeline, finalizedAt);
	const children = new Map<string, ChildTimeline>();
	for (const child of state.children.values()) {
		const terminalChild =
			child.status === 'running'
				? {
						...child,
						status: settledOnTermination(state, child),
						endedAt: finalizedAt,
					}
				: child;
		children.set(
			child.id,
			toChildTimeline(
				terminalChild,
				finalizeTimeline(
					child.timeline,
					finalizedAt,
					child.title,
					child.description,
				),
			),
		);
	}

	return {
		parts: timeline.parts,
		lastStatus: timeline.lastStatus,
		children,
	};
}

export function toDisplayState(state: ReduceState): DisplayState {
	const timeline = toTimelineDisplay(state.timeline);
	const children = new Map<string, ChildTimeline>();
	for (const child of state.children.values()) {
		children.set(
			child.id,
			toChildTimeline(
				child,
				toTimelineDisplay(child.timeline, child.title, child.description),
			),
		);
	}

	return {
		parts: timeline.parts,
		streamingTail: timeline.streamingTail,
		lastStatus: timeline.lastStatus,
		children,
	};
}

export function reduceEvents(events: SessionUpdate[]): AdapterResult {
	let state = createInitialState();
	const now = Date.now();

	for (let i = 0; i < events.length; i++) {
		const event = events[i];
		if (event === undefined) continue;
		const createdAt = now - (events.length - 1 - i) * 100;
		state = applyEvent(state, event, createdAt);
	}

	return finalizeState(state);
}

export function reduceTimedEvents(
	events: Array<{ event: SessionUpdate; createdAt: number }>,
	finalizedAt: number,
): AdapterResult {
	let state = createInitialState();

	for (const item of events) {
		state = applyEvent(state, item.event, item.createdAt);
	}

	return finalizeState(state, finalizedAt);
}
