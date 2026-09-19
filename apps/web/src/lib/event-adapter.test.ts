import { describe, expect, test } from 'bun:test';
import type { SessionUpdate } from '@oagent/engine';
import {
	applyEvent,
	createInitialState,
	finalizeState,
	toDisplayState,
} from './event-adapter';

describe('event adapter steer messages', () => {
	test('shows a steer message while it is streaming', () => {
		const event = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'steer-1',
			content: { type: 'text', text: 'Please add a test.' },
			_meta: { 'oagent/steer': true },
		} satisfies SessionUpdate;
		const state = applyEvent(createInitialState(), event, 1000);

		expect(toDisplayState(state).streamingTail).toEqual({
			kind: 'steer',
			id: 'steer-0',
			text: 'Please add a test.',
			createdAt: 1000,
		});
	});

	test('combines chunks from the same steer message', () => {
		const firstEvent = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'steer-1',
			content: { type: 'text', text: 'Please add ' },
			_meta: { 'oagent/steer': true },
		} satisfies SessionUpdate;
		const secondEvent = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'steer-1',
			content: { type: 'text', text: 'a test.' },
			_meta: { 'oagent/steer': true },
		} satisfies SessionUpdate;
		const firstState = applyEvent(createInitialState(), firstEvent, 1000);
		const secondState = applyEvent(firstState, secondEvent, 1100);

		expect(finalizeState(secondState).parts).toEqual([
			{
				kind: 'steer',
				id: 'steer-0',
				text: 'Please add a test.',
				createdAt: 1000,
			},
		]);
	});

	test('keeps separate steer messages separate', () => {
		const firstEvent = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'steer-1',
			content: { type: 'text', text: 'First message' },
			_meta: { 'oagent/steer': true },
		} satisfies SessionUpdate;
		const secondEvent = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'steer-2',
			content: { type: 'text', text: 'Second message' },
			_meta: { 'oagent/steer': true },
		} satisfies SessionUpdate;
		const firstState = applyEvent(createInitialState(), firstEvent, 1000);
		const secondState = applyEvent(firstState, secondEvent, 1100);

		expect(finalizeState(secondState).parts).toEqual([
			{
				kind: 'steer',
				id: 'steer-0',
				text: 'First message',
				createdAt: 1000,
			},
			{
				kind: 'steer',
				id: 'steer-1',
				text: 'Second message',
				createdAt: 1100,
			},
		]);
	});

	test('ignores user message chunks that are not steers', () => {
		const event = {
			sessionUpdate: 'user_message_chunk',
			messageId: 'prompt-1',
			content: { type: 'text', text: 'Initial prompt' },
		} satisfies SessionUpdate;
		const state = applyEvent(createInitialState(), event, 1000);

		expect(finalizeState(state).parts).toEqual([]);
	});
});
