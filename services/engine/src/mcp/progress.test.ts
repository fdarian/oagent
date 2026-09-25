import { expect, test } from 'bun:test';
import type { ServerContext } from '@modelcontextprotocol/server';
import { Effect } from 'effect';
import type { Jobs } from '../jobs.ts';
import { waitWithProgress } from './progress.ts';

test('replays job events, streams ordered progress, and waits for terminal', async () => {
	const updates: Array<{ progress: number; message: string }> = [];
	let listener: Parameters<Jobs['Service']['subscribe']>[1] | undefined;
	let running = true;
	let unsubscribed = false;
	const ctx = {
		mcpReq: {
			_meta: { progressToken: 'turn-1' },
			signal: new AbortController().signal,
			notify: async (notification: {
				params: { progress: number; message: string };
			}) => {
				updates.push({
					progress: notification.params.progress,
					message: notification.params.message,
				});
			},
		},
	} as unknown as ServerContext;
	const jobs = {
		subscribe: (_jobId: string, next: typeof listener) => {
			listener = next;
			return () => {
				unsubscribed = true;
			};
		},
		readEventsPage: () => ({
			events: [{ sequence: 1, event: { sessionUpdate: 'plan', entries: [] } }],
			nextCursor: null,
		}),
		getJobMetadata: () => ({ status: running ? 'running' : 'done' }),
		wait: () => Effect.succeed({ status: 'done' as const, text: 'OK' }),
	} as unknown as Jobs['Service'];
	const awaited = Effect.runPromise(waitWithProgress(jobs, 'job-1', ctx));
	await new Promise<void>((resolve) => setImmediate(resolve));
	expect(updates).toEqual([
		{ progress: 1, message: 'Agent is working' },
		{ progress: 2, message: 'Updated plan' },
	]);
	if (listener === undefined) throw new Error('Missing job listener');
	listener({
		type: 'event',
		sequence: 2,
		event: {
			sessionUpdate: 'tool_call',
			toolCallId: 't1',
			title: 'Inspect files',
			status: 'in_progress',
		},
	});
	listener({
		type: 'event',
		sequence: 3,
		event: {
			sessionUpdate: 'tool_call_update',
			toolCallId: 't1',
			title: 'Inspect files',
			status: 'completed',
		},
	});
	running = false;
	listener({ type: 'terminal' });
	expect(await awaited).toMatchObject({ status: 'done', text: 'OK' });
	expect(updates).toEqual([
		{ progress: 1, message: 'Agent is working' },
		{ progress: 2, message: 'Updated plan' },
		{ progress: 3, message: 'Running Inspect files' },
		{ progress: 4, message: 'Finished Inspect files' },
	]);
	expect(unsubscribed).toBe(true);
});

test('aborting a wait unsubscribes without cancelling the job', async () => {
	const controller = new AbortController();
	let unsubscribed = false;
	const ctx = {
		mcpReq: { signal: controller.signal },
	} as ServerContext;
	const jobs = {
		subscribe: () => () => {
			unsubscribed = true;
		},
		getJobMetadata: () => ({ status: 'running' }),
		wait: () =>
			Effect.die(new Error('An aborted request must not wait for the job')),
	} as unknown as Jobs['Service'];
	const awaited = Effect.runPromise(waitWithProgress(jobs, 'job-1', ctx));
	await new Promise<void>((resolve) => setImmediate(resolve));
	controller.abort();
	await expect(awaited).rejects.toMatchObject({ name: 'AbortError' });
	expect(unsubscribed).toBe(true);
});
