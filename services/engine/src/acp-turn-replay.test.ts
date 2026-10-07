import { expect, test } from 'bun:test';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { createAcpTurnReplay } from './acp-turn-replay.ts';

test('uses initial session history as a non-emitted replay baseline', () => {
	const event: SessionUpdate = {
		sessionUpdate: 'agent_message_chunk',
		messageId: 'msg_baseline',
		content: { type: 'text', text: 'already seen' },
	};
	const events: SessionUpdate[] = [];
	const replay = createAcpTurnReplay({
		initialLoad: true,
		onEvent: (update) => events.push(update),
	});

	replay.observe(event);
	replay.finishInitialLoad();
	replay.beginReplay();
	replay.observe(event);
	replay.completeReplay();

	expect(events).toEqual([]);
});

test('emits only the unseen suffix from a replayed full message', () => {
	const liveEvent: SessionUpdate = {
		sessionUpdate: 'agent_message_chunk',
		messageId: 'msg_current',
		content: { type: 'text', text: 'hel' },
	};
	const replayedEvent: SessionUpdate = {
		sessionUpdate: 'agent_message_chunk',
		messageId: 'msg_current',
		content: { type: 'text', text: 'hello' },
	};
	const events: SessionUpdate[] = [];
	const replay = createAcpTurnReplay({
		initialLoad: false,
		onEvent: (event) => events.push(event),
	});

	replay.observe(liveEvent);
	replay.beginReplay();
	replay.observe(replayedEvent);
	replay.completeReplay();

	expect(events).toEqual([
		liveEvent,
		{
			sessionUpdate: 'agent_message_chunk',
			messageId: 'msg_current',
			content: { type: 'text', text: 'lo' },
		},
	]);
});

const okChunk: SessionUpdate = {
	sessionUpdate: 'agent_message_chunk',
	content: { type: 'text', text: 'OK' },
};

function loadedReplay(historyCount: number) {
	const events: SessionUpdate[] = [];
	const replay = createAcpTurnReplay({
		initialLoad: true,
		onEvent: (update) => events.push(update),
	});
	for (let i = 0; i < historyCount; i++) replay.observe(okChunk);
	replay.finishInitialLoad();
	return { events, replay };
}

test('drops late history sent before the prompt is dispatched', () => {
	const loaded = loadedReplay(1);
	loaded.replay.observe(okChunk);
	expect(loaded.events).toEqual([]);
	loaded.replay.observe(okChunk);
	expect(loaded.events).toEqual([okChunk]);
});

test('keeps a live reply identical to history after the prompt is dispatched', () => {
	const loaded = loadedReplay(1);
	loaded.replay.markPromptDispatched();
	loaded.replay.observe(okChunk);
	loaded.replay.observe(okChunk);
	expect(loaded.events).toEqual([okChunk, okChunk]);
});

test('keeps a reply identical to history produced while disconnected', () => {
	const loaded = loadedReplay(1);
	loaded.replay.markPromptDispatched();
	loaded.replay.beginReplay();
	loaded.replay.observe(okChunk);
	loaded.replay.observe(okChunk);
	loaded.replay.completeReplay();
	expect(loaded.events).toEqual([okChunk]);
});

test('deduplicates every reconnect replay against the full history', () => {
	const loaded = loadedReplay(1);
	loaded.replay.markPromptDispatched();
	for (let i = 0; i < 2; i++) {
		loaded.replay.beginReplay();
		loaded.replay.observe(okChunk);
		loaded.replay.completeReplay();
	}
	expect(loaded.events).toEqual([]);
});
