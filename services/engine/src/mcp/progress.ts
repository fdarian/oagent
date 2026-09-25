import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { ServerContext } from '@modelcontextprotocol/server';
import { Effect } from 'effect';
import type { Jobs } from '../jobs.ts';

export function progressMessage(event: unknown): string | undefined {
	if (
		event === null ||
		typeof event !== 'object' ||
		!('sessionUpdate' in event)
	)
		return undefined;
	switch (event.sessionUpdate) {
		case 'tool_call':
		case 'tool_call_update': {
			if (!('status' in event)) return undefined;
			const title =
				'title' in event && typeof event.title === 'string'
					? event.title
					: 'tool';
			if (event.status === 'in_progress') return `Running ${title}`;
			if (event.status === 'completed') return `Finished ${title}`;
			if (event.status === 'failed') return `Failed ${title}`;
			return undefined;
		}
		case 'plan':
			return 'Updated plan';
		case 'current_mode_update':
			return 'currentModeId' in event && typeof event.currentModeId === 'string'
				? `Switched to ${event.currentModeId}`
				: undefined;
		default:
			return undefined;
	}
}

export function progressReporter(ctx: ServerContext) {
	const token = ctx.mcpReq._meta?.progressToken;
	let progress = 0;
	return async (message: string) => {
		if (token === undefined) return;
		progress += 1;
		await ctx.mcpReq.notify({
			method: 'notifications/progress',
			params: { progressToken: token, progress, message },
		});
	};
}

export function waitWithProgress(
	jobs: Pick<
		Jobs['Service'],
		'subscribe' | 'getJobMetadata' | 'readEventsPage' | 'wait'
	>,
	jobId: string,
	ctx: ServerContext,
) {
	return Effect.tryPromise({
		try: async () => {
			const report = progressReporter(ctx);
			await report('Agent is working');
			await new Promise<void>((resolve, reject) => {
				let finished = false;
				let lastSequence = 0;
				let notifications = Promise.resolve();
				let unsubscribe = (): void => {};
				const cleanup = () => {
					unsubscribe();
					ctx.mcpReq.signal.removeEventListener('abort', onAbort);
				};
				const fail = (cause: unknown) => {
					if (finished) return;
					finished = true;
					cleanup();
					reject(cause);
				};
				const onAbort = () =>
					fail(new DOMException('Request aborted', 'AbortError'));
				const finish = () => {
					if (finished) return;
					finished = true;
					cleanup();
					notifications.then(resolve, reject);
				};
				const onEvent = (event: SessionUpdate, sequence: number) => {
					if (finished || sequence <= lastSequence) return;
					lastSequence = sequence;
					const message = progressMessage(event);
					if (message !== undefined) {
						notifications = notifications.then(() => report(message));
						notifications.catch(fail);
					}
				};
				ctx.mcpReq.signal.addEventListener('abort', onAbort, { once: true });
				if (ctx.mcpReq.signal.aborted) {
					onAbort();
					return;
				}
				const buffered: Array<{ event: SessionUpdate; sequence: number }> = [];
				let replaying = true;
				let terminalDuringReplay = false;
				unsubscribe = jobs.subscribe(jobId, (payload) => {
					if (payload.type === 'terminal') {
						if (replaying) terminalDuringReplay = true;
						else finish();
					} else if (replaying) buffered.push(payload);
					else onEvent(payload.event, payload.sequence);
				});
				if (ctx.mcpReq._meta?.progressToken !== undefined) {
					let cursor = 0;
					for (;;) {
						const page = jobs.readEventsPage(jobId, cursor, 100);
						for (const item of page.events) onEvent(item.event, item.sequence);
						if (page.nextCursor === null) break;
						cursor = page.nextCursor;
					}
				}
				replaying = false;
				for (const item of buffered) onEvent(item.event, item.sequence);
				const job = jobs.getJobMetadata(jobId);
				if (job === undefined) fail(new Error(`Job not found: ${jobId}`));
				else if (terminalDuringReplay || job.status !== 'running') finish();
			});
		},
		catch: (cause) =>
			cause instanceof Error ? cause : new Error(String(cause)),
	}).pipe(Effect.flatMap(() => jobs.wait({ jobId })));
}
