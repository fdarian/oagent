import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import type { SideChatCreation } from './side-chat-creation.ts';

const window = new Window({ url: 'http://localhost/' });
Object.defineProperty(globalThis, 'location', {
	configurable: true,
	value: window.location,
});
const sideChatCreation = await import('./side-chat-creation.ts');

describe('side-chat creation guard', () => {
	test('does not apply an old drawer creation after navigating to another job', async () => {
		const creation = {
			sourceJobId: 'job-a',
			drawerInstance: 4,
		};
		const response = Promise.withResolvers<string>();
		const route: {
			jobId: string;
			drawerInstance: number;
			sideChatId?: string;
			drawerOpen: boolean;
		} = {
			jobId: 'job-a',
			drawerInstance: 4,
			sideChatId: undefined,
			drawerOpen: true,
		};
		const applyResponse = response.promise.then((sideChatId) => {
			if (
				!sideChatCreation.isCurrentSideChatCreation({
					creation,
					currentJobId: route.jobId,
					currentDrawerInstance: route.drawerInstance,
				})
			) {
				return;
			}
			route.sideChatId = sideChatId;
			route.drawerOpen = true;
		});

		route.jobId = 'job-b';
		route.drawerInstance = 5;
		route.drawerOpen = false;
		response.resolve('chat-a');

		await applyResponse;
		expect(route).toEqual({
			jobId: 'job-b',
			drawerInstance: 5,
			sideChatId: undefined,
			drawerOpen: false,
		});
	});

	test('does not apply a response after the originating drawer closes', () => {
		const creation = {
			sourceJobId: 'job-a',
			drawerInstance: 4,
		};

		expect(
			sideChatCreation.isCurrentSideChatCreation({
				creation,
				currentJobId: 'job-a',
				currentDrawerInstance: 5,
			}),
		).toBeFalse();
	});

	test('allows a second job to create while the first job remains pending', async () => {
		const delayedA = Promise.withResolvers<string>();
		const successfulB = Promise.withResolvers<string>();
		const creationA = { sourceJobId: 'job-a', drawerInstance: 4 };
		const creationB = { sourceJobId: 'job-b', drawerInstance: 7 };
		const queryClient = new QueryClient();
		const mutationA = queryClient.getMutationCache().build(queryClient, {
			mutationKey: sideChatCreation.sideChatCreateMutationKey,
			mutationFn: () => delayedA.promise,
		});
		const mutationB = queryClient.getMutationCache().build(queryClient, {
			mutationKey: sideChatCreation.sideChatCreateMutationKey,
			mutationFn: () => successfulB.promise,
		});
		const route: {
			jobId: string;
			drawerInstance: number;
			sideChatId?: string;
		} = {
			jobId: 'job-a',
			drawerInstance: 4,
			sideChatId: undefined,
		};
		const applyResponse = (creation: SideChatCreation, sideChatId: string) => {
			if (
				!sideChatCreation.isCurrentSideChatCreation({
					creation,
					currentJobId: route.jobId,
					currentDrawerInstance: route.drawerInstance,
				})
			) {
				return;
			}
			route.sideChatId = sideChatId;
		};

		const pendingA = mutationA.execute(creationA);
		expect(
			queryClient.isMutating(
				sideChatCreation.sideChatCreateMutationFilter('job-a'),
			),
		).toBe(1);

		route.jobId = 'job-b';
		route.drawerInstance = 7;
		expect(
			queryClient.isMutating(
				sideChatCreation.sideChatCreateMutationFilter('job-b'),
			),
		).toBe(0);

		const pendingB = mutationB.execute(creationB);
		expect(
			queryClient.isMutating(
				sideChatCreation.sideChatCreateMutationFilter('job-b'),
			),
		).toBe(1);
		expect(
			queryClient.isMutating(
				sideChatCreation.sideChatCreateMutationFilter('job-a'),
			),
		).toBe(1);

		successfulB.resolve('chat-b');
		applyResponse(creationB, await pendingB);
		expect(
			queryClient.isMutating(
				sideChatCreation.sideChatCreateMutationFilter('job-b'),
			),
		).toBe(0);
		expect(
			queryClient.isMutating(
				sideChatCreation.sideChatCreateMutationFilter('job-a'),
			),
		).toBe(1);
		delayedA.resolve('chat-a');
		applyResponse(creationA, await pendingA);

		expect(route.sideChatId).toBe('chat-b');
	});
});
