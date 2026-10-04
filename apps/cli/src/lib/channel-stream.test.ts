import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { listenForTerminal } from './channel-stream.ts';

test('reconnects after fetch and stream errors and completes', async () => {
	const state = { connections: 0 };
	const server = Bun.serve({
		port: 0,
		fetch: () => {
			state.connections += 1;
			if (state.connections === 1)
				return new Response('restarting', { status: 503 });
			if (state.connections === 2)
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new Error('Transport lost'));
						},
					}),
				);
			return new Response(
				'data: {"sessionUpdate":"plan","entries":[]}\n\ndata: "__terminal__"\n\n',
				{ headers: { 'content-type': 'text/event-stream' } },
			);
		},
	});
	const events: unknown[] = [];
	try {
		await Effect.runPromise(
			listenForTerminal(
				server.url.toString(),
				'job-1',
				async (event) => {
					events.push(event);
				},
				{ initialDelayMs: 5, maxDelayMs: 10, retryBudgetMs: 1_000 },
			),
		);
		expect(state.connections).toBe(3);
		expect(events).toEqual([{ sessionUpdate: 'plan', entries: [] }]);
	} finally {
		await server.stop(true);
	}
});

test('an aborted listener does not keep reconnecting', async () => {
	const controller = new AbortController();
	const server = Bun.serve({
		port: 0,
		fetch: () => new Response('restarting', { status: 503 }),
	});
	try {
		const pending = Effect.runPromise(
			listenForTerminal(server.url.toString(), 'job-1', async () => {}),
			{ signal: controller.signal },
		);
		controller.abort();
		await expect(pending).rejects.toBeDefined();
	} finally {
		await server.stop(true);
	}
});
