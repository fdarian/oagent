import { FetchHttpClient, HttpApiClient } from '@effect/platform';
import { EngineApi } from '@oagent/engine/api';
import { Effect } from 'effect';

function resolveBaseUrl(): string {
	if (import.meta.env.DEV) {
		return location.origin;
	}
	const engine = new URLSearchParams(location.search).get('engine');
	if (engine !== null) {
		return engine;
	}
	return location.origin;
}

async function makeClient() {
	return Effect.runPromise(
		HttpApiClient.make(EngineApi, { baseUrl: resolveBaseUrl() }).pipe(
			Effect.provide(FetchHttpClient.layer),
		),
	);
}

type EngineHttpClient = Awaited<ReturnType<typeof makeClient>>;

let clientPromise: Promise<EngineHttpClient> | undefined;

function memoizedClient(): Promise<EngineHttpClient> {
	if (clientPromise === undefined) {
		clientPromise = makeClient();
	}
	return clientPromise;
}

export const orpc = {
	jobs: {
		list: () =>
			memoizedClient().then((client) => Effect.runPromise(client.jobs.list())),
		cancel: (args: { jobId: string }) =>
			memoizedClient().then((client) =>
				Effect.runPromise(
					client.jobs.cancel({ path: { jobId: args.jobId } }),
				),
			),
	},
	models: {
		list: (args: { backend: 'opencode' | 'cursor' | 'grok' }) =>
			memoizedClient().then((client) =>
				Effect.runPromise(
					client.models.list({ path: { backend: args.backend } }),
				),
			),
	},
	aliases: {
		list: () =>
			memoizedClient().then((client) =>
				Effect.runPromise(client.aliases.list()),
			),
		save: (input: {
			name: string;
			backend: 'opencode' | 'cursor' | 'grok';
			model_id: string;
			description?: string;
		}) =>
			memoizedClient().then((client) =>
				Effect.runPromise(client.aliases.save({ payload: input })),
			),
		delete: (args: { name: string }) =>
			memoizedClient().then((client) =>
				Effect.runPromise(
					client.aliases.delete({ path: { name: args.name } }),
				),
			),
	},
};