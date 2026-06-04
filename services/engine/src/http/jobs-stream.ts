import type { Jobs } from '../jobs.ts';

export function handleJobsStream(jobs: Jobs, signal: AbortSignal): Response {
	let unsubscribe = (): void => {};
	let closed = false;

	const stream = new ReadableStream({
		start(controller) {
			const encode = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

			const safeClose = () => {
				if (closed) return;
				closed = true;
				controller.close();
			};
			const safeEnqueue = (data: string) => {
				if (closed) return;
				controller.enqueue(data);
			};

			const onAbort = (): void => {
				unsubscribe();
				safeClose();
			};

			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) {
				onAbort();
				return;
			}

			safeEnqueue(': connected\n\n');

			const keepAlive = setInterval(() => {
				safeEnqueue(': keep-alive\n\n');
			}, 25_000);

			const listener = (change: {
				type: 'created' | 'status';
				jobId: string;
				status?: string;
			}) => {
				safeEnqueue(encode(change));
			};

			unsubscribe = jobs.subscribeJobs(listener);

			const cleanup = (): void => {
				clearInterval(keepAlive);
				unsubscribe();
				signal.removeEventListener('abort', onAbort);
			};

			signal.addEventListener('abort', cleanup, { once: true });
		},
		cancel(_reason) {
			closed = true;
			unsubscribe();
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
		},
	});
}
