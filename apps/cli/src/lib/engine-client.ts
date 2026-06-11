import { FetchHttpClient, HttpApiClient } from '@effect/platform';
import { EngineApi } from '@oagent/engine';
import { Effect, Layer } from 'effect';

export const defaultEngineUrl = `http://localhost:${process.env.OPENCODE_MCP_PORT ?? '17777'}`;

/**
 * Custom fetch that disables Bun's default 300s timeout so long-poll wait
 * requests (held up to CHUNK_MS = 10 min by the engine) aren't guillotined
 * before the server responds.
 */
const fetchNoTimeout = ((
	request: Request,
	init?: RequestInit,
): Promise<Response> =>
	fetch(request, {
		...init,
		// @ts-expect-error — `timeout` is a Bun-specific RequestInit extension, not in DOM lib types
		timeout: false,
	})) as typeof fetch;

const fetchLayer = FetchHttpClient.layer.pipe(
	Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchNoTimeout)),
);

async function makeClient(engineUrl: string) {
	return Effect.runPromise(
		HttpApiClient.make(EngineApi, { baseUrl: engineUrl }).pipe(
			Effect.provide(fetchLayer),
		),
	);
}

type EngineHttpClient = Awaited<ReturnType<typeof makeClient>>;

const clients = new Map<string, Promise<EngineHttpClient>>();

function memoizedClient(engineUrl: string): Promise<EngineHttpClient> {
	let existing = clients.get(engineUrl);
	if (existing === undefined) {
		existing = makeClient(engineUrl);
		clients.set(engineUrl, existing);
	}
	return existing;
}

export function createEngineClient(engineUrl: string) {
	return {
		jobs: {
			list: () =>
				memoizedClient(engineUrl).then((client) =>
					Effect.runPromise(client.jobs.list()),
				),
			start: (args: {
				prompt: string;
				cwd: string;
				model?: string;
				sessionId?: string;
			}) =>
				memoizedClient(engineUrl).then((client) =>
					Effect.runPromise(client.jobs.start({ payload: args })),
				),
			wait: (args: { jobId: string; timeoutMs?: number }) =>
				memoizedClient(engineUrl).then((client) =>
					Effect.runPromise(
						client.jobs.wait({
							path: { jobId: args.jobId },
							urlParams: { timeoutMs: args.timeoutMs },
						}),
					),
				),
			cancel: (args: { jobId: string }) =>
				memoizedClient(engineUrl).then((client) =>
					Effect.runPromise(
						client.jobs.cancel({ path: { jobId: args.jobId } }),
					),
				),
		},
		aliases: {
			list: () =>
				memoizedClient(engineUrl).then((client) =>
					Effect.runPromise(client.aliases.list()),
				),
		},
	};
}

export type EngineClient = ReturnType<typeof createEngineClient>;
