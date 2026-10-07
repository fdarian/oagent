import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { eventDedupeKey } from './event-key.ts';

type AcpTurnReplayInput = {
	initialLoad: boolean;
	onEvent: (event: SessionUpdate) => void;
};

export type AcpTurnReplay = {
	observe: (event: SessionUpdate) => void;
	finishInitialLoad: () => void;
	markPromptDispatched: () => void;
	beginReplay: () => void;
	completeReplay: () => void;
	failReplay: () => void;
};

export function createAcpTurnReplay(input: AcpTurnReplayInput): AcpTurnReplay {
	const state = {
		initialLoad: input.initialLoad,
		replaying: false,
		replayEvents: [] as Array<SessionUpdate>,
		promptDispatched: false,
		baselineCounts: new Map<string, number>(),
		lateHistoryCounts: new Map<string, number>(),
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

	const consumeCount = (
		counts: Map<string, number>,
		event: SessionUpdate,
	): boolean => {
		const key = eventDedupeKey(event);
		const remaining = counts.get(key);
		if (remaining === undefined || remaining === 0) return false;
		counts.set(key, remaining - 1);
		return true;
	};

	const appendReplayEvent = (
		event: SessionUpdate,
		replayCounts: Map<string, number>,
	): void => {
		if (consumeCount(replayCounts, event)) return;
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
		if (state.initialLoad) {
			const key = eventDedupeKey(event);
			state.baselineCounts.set(key, (state.baselineCounts.get(key) ?? 0) + 1);
			return;
		}
		if (state.replaying) {
			state.replayEvents.push(event);
			return;
		}
		// Adapters may keep streaming history after answering session/load, so
		// until the prompt is sent, events matching history are dropped. Once it
		// is sent, identical text (e.g. a second "OK") is a genuine new reply and
		// can't be told apart from history without message IDs.
		if (!state.promptDispatched && consumeCount(state.lateHistoryCounts, event))
			return;
		appendEvent(event);
	};

	return {
		observe,
		finishInitialLoad: () => {
			state.initialLoad = false;
			state.lateHistoryCounts = new Map(state.baselineCounts);
		},
		markPromptDispatched: () => {
			state.promptDispatched = true;
		},
		beginReplay: () => {
			state.replaying = true;
		},
		completeReplay: () => {
			state.replaying = false;
			// Each reload replays the whole history again, so it gets a fresh copy.
			const replayCounts = new Map(state.baselineCounts);
			for (const event of state.replayEvents) {
				appendReplayEvent(event, replayCounts);
			}
			state.replayEvents.length = 0;
		},
		failReplay: () => {
			state.replaying = false;
			state.replayEvents.length = 0;
		},
	};
}
