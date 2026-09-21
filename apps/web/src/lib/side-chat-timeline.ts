import type { SessionUpdate } from '@oagent/engine';
import { reduceTimedEvents, type TimelinePart } from '@/lib/event-adapter.ts';
import type { JobEventsState } from '@/lib/use-job-events.ts';

export type SideChatTurn = {
	id: string;
	status: 'running' | 'done' | 'error' | 'cancelled';
	createdAt: number;
	terminatedAt?: number;
	prompt: string;
	errorMessage?: string;
	events: Array<{ event: SessionUpdate; createdAt: number }>;
};

export type SideChat = {
	id: string;
	createdAt: number;
	turns: SideChatTurn[];
};

export type SideChatTimeline = {
	parts: TimelinePart[];
	streamingTail: TimelinePart | null;
	lastStatus?: string;
	activeTurnId?: string;
	isRunning: boolean;
};

function prefixPart(part: TimelinePart, turnId: string): TimelinePart {
	return { ...part, id: `${turnId}:${part.id}` };
}

function sideChatErrorPart(turn: SideChatTurn): TimelinePart | undefined {
	if (turn.errorMessage === undefined) return undefined;
	if (turn.terminatedAt === undefined) {
		throw new Error(
			`Side-chat turn ${turn.id} has an error without termination`,
		);
	}
	return {
		kind: 'error',
		id: `${turn.id}:error`,
		message: turn.errorMessage,
		createdAt: turn.terminatedAt,
	};
}

function persistedTurnParts(turn: SideChatTurn): TimelinePart[] {
	if (turn.terminatedAt === undefined) {
		throw new Error(`Side-chat turn ${turn.id} has no termination time`);
	}
	return reduceTimedEvents(turn.events, turn.terminatedAt).parts;
}

export function getRunningSideChatTurn(
	sideChat: SideChat | undefined,
): SideChatTurn | undefined {
	if (sideChat === undefined) return undefined;
	return sideChat.turns.find((turn) => turn.status === 'running');
}

export function createSideChatTimeline(
	sideChat: SideChat | undefined,
	activeEvents: JobEventsState | undefined,
): SideChatTimeline {
	if (sideChat === undefined) {
		return {
			parts: [],
			streamingTail: null,
			isRunning: false,
		};
	}

	const activeTurn = getRunningSideChatTurn(sideChat);
	const parts: TimelinePart[] = [];
	let streamingTail: TimelinePart | null = null;

	for (const turn of sideChat.turns) {
		parts.push({
			kind: 'user',
			id: `${turn.id}:prompt`,
			text: turn.prompt,
			createdAt: turn.createdAt,
		});

		const isActiveTurn = activeTurn?.id === turn.id;
		const turnParts = isActiveTurn
			? activeEvents?.parts
			: persistedTurnParts(turn);
		if (turnParts !== undefined) {
			for (const part of turnParts) {
				parts.push(prefixPart(part, turn.id));
			}
		}

		const activeTail = isActiveTurn ? activeEvents?.streamingTail : null;
		if (activeTail !== undefined && activeTail !== null) {
			streamingTail = prefixPart(activeTail, turn.id);
		}

		const errorPart = sideChatErrorPart(turn);
		if (errorPart !== undefined) parts.push(errorPart);
	}

	return {
		parts,
		streamingTail,
		lastStatus: activeEvents?.lastStatus,
		activeTurnId: activeTurn?.id,
		isRunning: activeTurn !== undefined && activeEvents?.terminal !== true,
	};
}
