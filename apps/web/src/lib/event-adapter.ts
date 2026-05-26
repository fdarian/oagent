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
};

export function createInitialState(): ReduceState {
	return {
		parts: [],
		openText: null,
		openReasoning: null,
		toolIndices: new Map(),
		idCounter: 0,
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
						createdAt,
					},
				],
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
			content: event.content ?? existing.content,
			locations: event.locations ?? existing.locations,
			createdAt: existing.createdAt,
			durationMs,
		};
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
			event.content !== null && event.content !== undefined
				? event.content
				: existing.content;
		const nextLocations =
			event.locations !== null && event.locations !== undefined
				? event.locations
				: existing.locations;
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
			createdAt: existing.createdAt,
			durationMs,
		};
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

function computeLastStatus(parts: TimelinePart[]): string | undefined {
	for (let j = parts.length - 1; j >= 0; j--) {
		const part = parts[j];
		if (part === undefined) continue;
		if (
			part.kind === 'tool' &&
			(part.state === 'input-streaming' || part.state === 'input-available')
		) {
			return `Running tool: ${part.title}`;
		}
	}
	return undefined;
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
		lastStatus: computeLastStatus(parts),
	};
}

export function toDisplayState(state: ReduceState): AdapterResult {
	const effectiveParts: TimelinePart[] = [...state.parts];
	if (state.openText !== null) {
		effectiveParts.push({
			kind: 'text',
			id: state.openText.id,
			text: state.openText.text,
			createdAt: state.openText.createdAt,
		});
	}
	if (state.openReasoning !== null) {
		effectiveParts.push({
			kind: 'reasoning',
			id: state.openReasoning.id,
			text: state.openReasoning.text,
			isStreaming: true,
			createdAt: state.openReasoning.createdAt,
		});
	}
	return {
		parts: effectiveParts,
		lastStatus: computeLastStatus(effectiveParts),
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
