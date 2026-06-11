import type {
	SessionUpdate,
	ToolCallContent,
	ToolCallLocation,
	ToolKind,
} from '@oagent/engine';

export type TimelinePart =
	| { kind: 'text'; id: string; text: string; createdAt: number }
	| {
			kind: 'reasoning';
			id: string;
			text: string;
			isStreaming: boolean;
			createdAt: number;
			durationMs?: number;
	  }
	| {
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
			createdAt: number;
			durationMs?: number;
	  }
	| {
			kind: 'error';
			id: string;
			message: string;
			code?: string;
			createdAt: number;
	  };

export type AdapterResult = {
	parts: TimelinePart[];
	lastStatus?: string;
};

export type DisplayState = {
	parts: TimelinePart[];
	streamingTail: TimelinePart | null;
	lastStatus?: string;
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

type OpenReasoning = {
	kind: 'reasoning';
	id: string;
	text: string;
	isStreaming: boolean;
	createdAt: number;
	messageId?: string | null;
};

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

export type ReduceState = {
	parts: TimelinePart[];
	openText: OpenText | null;
	openReasoning: OpenReasoning | null;
	toolIndices: Map<string, number>;
	idCounter: number;
	runningToolId: string | undefined;
	runningToolTitle: string | undefined;
};

export function createInitialState(): ReduceState {
	return {
		parts: [],
		openText: null,
		openReasoning: null,
		toolIndices: new Map(),
		idCounter: 0,
		runningToolId: undefined,
		runningToolTitle: undefined,
	};
}

function flushOpenText(state: ReduceState): ReduceState {
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

function flushOpenReasoning(
	state: ReduceState,
	createdAt: number,
): ReduceState {
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

export function applyEvent(
	state: ReduceState,
	event: SessionUpdate,
	createdAt: number,
): ReduceState {
	const isAccumulatingChunk =
		event.sessionUpdate === 'agent_message_chunk' ||
		event.sessionUpdate === 'agent_thought_chunk';
	const isFlushOnlyChunk = event.sessionUpdate === 'user_message_chunk';

	let nextState = state;

	if (!isAccumulatingChunk) {
		nextState = flushOpenText(nextState);
		nextState = flushOpenReasoning(nextState, createdAt);
	}

	if (isFlushOnlyChunk) {
		return nextState;
	}

	if (event.sessionUpdate === 'agent_message_chunk') {
		const chunkMessageId = event.messageId;
		const contentBlock = event.content;
		const chunkText =
			contentBlock.type === 'text' ? contentBlock.text : undefined;

		// Flush reasoning if open (different kind of chunk)
		nextState = flushOpenReasoning(nextState, createdAt);

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

	// Ignored variants: plan, available_commands_update, current_mode_update,
	// config_option_update, session_info_update, usage_update
	// Open text/reasoning already flushed above.
	return nextState;
}

export function finalizeState(state: ReduceState): AdapterResult {
	let parts = state.parts;
	let openText = state.openText;
	let openReasoning = state.openReasoning;

	if (openText !== null) {
		parts = [
			...parts,
			{
				kind: 'text',
				id: openText.id,
				text: openText.text,
				createdAt: openText.createdAt,
			},
		];
		openText = null;
	}
	if (openReasoning !== null) {
		const durationMs = Date.now() - openReasoning.createdAt;
		parts = [
			...parts,
			{
				kind: 'reasoning',
				id: openReasoning.id,
				text: openReasoning.text,
				isStreaming: false,
				createdAt: openReasoning.createdAt,
				durationMs,
			},
		];
		openReasoning = null;
	}

	return {
		parts,
		lastStatus:
			state.runningToolTitle !== undefined
				? `Running tool: ${state.runningToolTitle}`
				: undefined,
	};
}

export function toDisplayState(state: ReduceState): DisplayState {
	const streamingTail: TimelinePart | null =
		state.openText !== null
			? {
					kind: 'text',
					id: state.openText.id,
					text: state.openText.text,
					createdAt: state.openText.createdAt,
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
		lastStatus:
			state.runningToolTitle !== undefined
				? `Running tool: ${state.runningToolTitle}`
				: undefined,
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
