import { Context, Effect, Layer, Ref, Schema } from 'effect';
import { Codex } from './codex.ts';
import { Cursor } from './cursor.ts';
import { Grok } from './grok.ts';
import { OpenCode, type OpenCodeEffortOption } from './opencode.ts';

export type Backend = 'opencode' | 'cursor' | 'grok' | 'codex';

export type ModelEntry = { id: string; label?: string };

export type AgentTargetEntry = {
	id: string;
	label: string;
	description?: string;
};

type CacheEntry = {
	models: ReadonlyArray<ModelEntry>;
	agentTargets: ReadonlyArray<AgentTargetEntry>;
	fetchedAt: number;
};

type CatalogData = Pick<CacheEntry, 'models' | 'agentTargets'>;

type EffortCacheEntry = {
	efforts: ReadonlyArray<OpenCodeEffortOption>;
	fetchedAt: number;
};

const TTL_MS = 5 * 60 * 1000; // 5 minutes

export class ModelCatalogError extends Schema.TaggedError<ModelCatalogError>()(
	'ModelCatalogError',
	{
		backend: Schema.String,
		message: Schema.String,
	},
) {}

export class ModelCatalog extends Context.Service<ModelCatalog>()(
	'oagent/ModelCatalog',
	{
		make: Effect.gen(function* () {
			const opencode = yield* OpenCode;
			const cursor = yield* Cursor;
			const grok = yield* Grok;
			const codex = yield* Codex;
			const cache = yield* Ref.make(new Map<Backend, CacheEntry>());
			const effortCache = yield* Ref.make(new Map<string, EffortCacheEntry>());

			const fetch = (
				backend: Backend,
			): Effect.Effect<CatalogData, ModelCatalogError> => {
				const inner = (() => {
					if (backend === 'opencode') {
						return opencode.listSessionCatalog().pipe(
							Effect.map((catalog) => ({
								models: catalog.models,
								agentTargets: catalog.modes.map((mode) => ({
									id: mode.id,
									label: mode.name,
									...(mode.description === undefined
										? {}
										: { description: mode.description }),
								})),
							})),
						);
					}
					const models = (() => {
						if (backend === 'grok') return grok.listModels();
						if (backend === 'codex') return codex.listModels();
						return cursor.listModels();
					})();
					return models.pipe(
						Effect.map(
							(entries): CatalogData => ({
								models: entries,
								agentTargets: [],
							}),
						),
					);
				})();
				return inner.pipe(
					Effect.catch(
						(cause) =>
							new ModelCatalogError({
								backend,
								message: `Failed to list capabilities for ${backend}: ${String(cause)}`,
							}),
					),
				);
			};

			const fetchEfforts = (
				backend: Backend,
				model: string,
			): Effect.Effect<
				ReadonlyArray<OpenCodeEffortOption>,
				ModelCatalogError
			> => {
				if (backend !== 'opencode') return Effect.succeed([]);
				return opencode.listModelEfforts(model).pipe(
					Effect.catch((cause) =>
						Effect.fail(
							new ModelCatalogError({
								backend,
								message: `Failed to list reasoning efforts for ${backend}: ${String(cause)}`,
							}),
						),
					),
				);
			};

			const listEfforts = (
				backend: Backend,
				model: string,
			): Effect.Effect<
				ReadonlyArray<OpenCodeEffortOption>,
				ModelCatalogError
			> => {
				if (backend !== 'opencode') return Effect.succeed([]);
				return Effect.gen(function* () {
					const now = Date.now();
					const current = yield* Ref.get(effortCache);
					const entry = current.get(model);
					if (entry !== undefined && now - entry.fetchedAt < TTL_MS) {
						return entry.efforts;
					}
					const efforts = yield* fetchEfforts(backend, model);
					yield* Ref.update(effortCache, (m) => {
						const next = new Map(m);
						next.set(model, { efforts, fetchedAt: now });
						return next;
					});
					return efforts;
				});
			};

			const getCatalog = (
				backend: Backend,
			): Effect.Effect<CatalogData, ModelCatalogError> =>
				Effect.gen(function* () {
					const now = Date.now();
					const current = yield* Ref.get(cache);
					const entry = current.get(backend);
					if (entry !== undefined && now - entry.fetchedAt < TTL_MS) {
						return entry;
					}
					const catalog = yield* fetch(backend);
					if (catalog.models.length > 0 || catalog.agentTargets.length > 0) {
						yield* Ref.update(cache, (m) => {
							const next = new Map(m);
							next.set(backend, { ...catalog, fetchedAt: now });
							return next;
						});
					}
					return catalog;
				});

			const list = (
				backend: Backend,
			): Effect.Effect<ReadonlyArray<ModelEntry>, ModelCatalogError> =>
				getCatalog(backend).pipe(Effect.map((catalog) => catalog.models));

			const listAgentTargets = (
				backend: Backend,
			): Effect.Effect<ReadonlyArray<AgentTargetEntry>, ModelCatalogError> => {
				if (backend !== 'opencode') {
					return Effect.succeed([]);
				}
				return getCatalog(backend).pipe(
					Effect.map((catalog) => catalog.agentTargets),
				);
			};

			const invalidate = (backend: Backend) =>
				Effect.gen(function* () {
					yield* Ref.update(cache, (current) => {
						const next = new Map(current);
						next.delete(backend);
						return next;
					});
					if (backend === 'opencode') {
						yield* Ref.set(effortCache, new Map<string, EffortCacheEntry>());
					}
				});

			return { list, listEfforts, listAgentTargets, invalidate };
		}),
	},
) {
	static readonly layer = Layer.effect(ModelCatalog, ModelCatalog.make).pipe(
		Layer.provide(OpenCode.layer),
		Layer.provide(Cursor.layer),
		Layer.provide(Grok.layer),
		Layer.provide(Codex.layer),
	);
}
