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
