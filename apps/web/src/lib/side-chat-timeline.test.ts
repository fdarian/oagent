import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@oagent/engine';
import { createSideChatTimeline, type SideChat } from './side-chat-timeline';

describe('side-chat timeline', () => {
	test('orders raw prompts, persisted events, and turn errors', () => {
		const response = {
			sessionUpdate: 'agent_message_chunk',
			messageId: 'message-1',
			content: { type: 'text', text: 'Forked response' },
		} satisfies SessionUpdate;
		const sideChat = {
			id: 'chat-1',
			createdAt: 10,
			turns: [
				{
					id: 'turn-1',
					status: 'done',
					createdAt: 20,
					terminatedAt: 30,
					prompt: 'First raw prompt',
					events: [{ event: response, createdAt: 25 }],
				},
				{
					id: 'turn-2',
					status: 'error',
					createdAt: 40,
					terminatedAt: 50,
					prompt: 'Second raw prompt',
					errorMessage: 'The forked turn failed',
					events: [],
				},
			],
		} satisfies SideChat;

		const timeline = createSideChatTimeline(sideChat, undefined);

		expect(timeline.parts).toEqual([
			{
				kind: 'user',
				id: 'turn-1:prompt',
				text: 'First raw prompt',
				createdAt: 20,
			},
			{
				kind: 'text',
				id: 'turn-1:text-0',
				text: 'Forked response',
				createdAt: 25,
			},
			{
				kind: 'user',
				id: 'turn-2:prompt',
				text: 'Second raw prompt',
				createdAt: 40,
			},
			{
				kind: 'error',
				id: 'turn-2:error',
				message: 'The forked turn failed',
				createdAt: 50,
			},
		]);
	});

	test('uses one live stream for a running turn instead of replaying persisted events', () => {
		const persistedResponse = {
			sessionUpdate: 'agent_message_chunk',
			messageId: 'persisted',
			content: { type: 'text', text: 'Persisted response' },
		} satisfies SessionUpdate;
		const sideChat = {
			id: 'chat-1',
			createdAt: 10,
			turns: [
				{
					id: 'turn-1',
					status: 'running',
					createdAt: 20,
					prompt: 'Running raw prompt',
					events: [{ event: persistedResponse, createdAt: 25 }],
				},
			],
		} satisfies SideChat;

		const timeline = createSideChatTimeline(sideChat, {
			parts: [
				{
					kind: 'text',
					id: 'text-0',
					text: 'Live response',
					createdAt: 26,
				},
			],
			streamingTail: {
				kind: 'text',
				id: 'text-1',
				text: ' tail',
				createdAt: 27,
			},
			children: new Map(),
			terminal: false,
			isLoading: false,
		});

		expect(timeline.parts).toEqual([
			{
				kind: 'user',
				id: 'turn-1:prompt',
				text: 'Running raw prompt',
				createdAt: 20,
			},
			{
				kind: 'text',
				id: 'turn-1:text-0',
				text: 'Live response',
				createdAt: 26,
			},
		]);
		expect(timeline.streamingTail).toEqual({
			kind: 'text',
			id: 'turn-1:text-1',
			text: ' tail',
			createdAt: 27,
		});
		expect(timeline.isRunning).toBe(true);
	});
});
