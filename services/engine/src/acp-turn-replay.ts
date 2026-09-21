import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { eventDedupeKey } from './event-key.ts';

type AcpTurnReplayInput = {
	initialLoad: boolean;
	onEvent: (event: SessionUpdate) => void;
};

export type AcpTurnReplay = {
	observe: (event: SessionUpdate) => void;
	finishInitialLoad: () => void;
	beginReplay: () => void;
	completeReplay: () => void;
	failReplay: () => void;
};

export function createAcpTurnReplay(input: AcpTurnReplayInput): AcpTurnReplay {
	const state = {
		initialLoad: input.initialLoad,
		replaying: false,
		replayEvents: [] as Array<SessionUpdate>,
		baselineEventKeys: new Set<string>(),
		messageText: new Map<string, string>(),
	};

	const appendEvent = (event: SessionUpdate): void => {
		if (
			(event.sessionUpdate === 'user_message_chunk' ||
				event.sessionUpdate === 'agent_message_chunk' ||
				event.sessionUpdate === 'agent_thought_chunk') &&
			event.content.type === 'text' &&
			typeof event.messageId === 'string'
		) {
			const previous = state.messageText.get(event.messageId);
			if (previous === undefined) {
				state.messageText.set(event.messageId, event.content.text);
			} else {
				state.messageText.set(event.messageId, previous + event.content.text);
			}
		}
		input.onEvent(event);
	};

	const appendReplayEvent = (event: SessionUpdate): void => {
		if (state.baselineEventKeys.has(eventDedupeKey(event))) return;
		if (
			(event.sessionUpdate === 'user_message_chunk' ||
				event.sessionUpdate === 'agent_message_chunk' ||
				event.sessionUpdate === 'agent_thought_chunk') &&
			event.content.type === 'text' &&
			typeof event.messageId === 'string'
		) {
			const previous = state.messageText.get(event.messageId);
			if (previous !== undefined) {
				if (event.content.text.startsWith(previous)) {
					const suffix = event.content.text.slice(previous.length);
					if (suffix.length === 0) return;
					appendEvent({
						...event,
						content: { ...event.content, text: suffix },
					} as SessionUpdate);
					return;
				}
				if (previous.startsWith(event.content.text)) return;
			}
		}
		appendEvent(event);
	};

	const observe = (event: SessionUpdate): void => {
		const key = eventDedupeKey(event);
		if (state.initialLoad) {
			state.baselineEventKeys.add(key);
			return;
		}
		if (state.replaying) {
			state.replayEvents.push(event);
			return;
		}
		if (state.baselineEventKeys.has(key)) return;
		appendEvent(event);
	};

	return {
		observe,
		finishInitialLoad: () => {
			state.initialLoad = false;
		},
		beginReplay: () => {
			state.replaying = true;
		},
		completeReplay: () => {
			state.replaying = false;
			for (const event of state.replayEvents) {
				appendReplayEvent(event);
			}
			state.replayEvents.length = 0;
		},
		failReplay: () => {
			state.replaying = false;
			state.replayEvents.length = 0;
		},
	};
}
