import { Context, Effect, Layer, Ref } from 'effect';
import {
	type Backend,
	HarnessRegistry,
	ModelCatalogError,
	type ModelEffort,
	type ModelEntry,
} from './harness.ts';

type CacheEntry = {
	models: ReadonlyArray<ModelEntry>;
	fetchedAt: number;
};

type EffortCacheEntry = {
	efforts: ReadonlyArray<ModelEffort>;
	fetchedAt: number;
};

const TTL_MS = 5 * 60 * 1000; // 5 minutes

export class ModelCatalog extends Context.Service<ModelCatalog>()(
	'oagent/ModelCatalog',
	{
		make: Effect.gen(function* () {
			const harnessRegistry = yield* HarnessRegistry;
			const cache = yield* Ref.make(new Map<Backend, CacheEntry>());
			const effortCache = yield* Ref.make(new Map<string, EffortCacheEntry>());

			const fetch = (
				backend: Backend,
			): Effect.Effect<ReadonlyArray<ModelEntry>, ModelCatalogError> => {
				const inner = harnessRegistry.get(backend).listModels();
				return inner.pipe(
					Effect.catch((cause) =>
						Effect.fail(
							new ModelCatalogError({
								backend,
								message: `Failed to list models for ${backend}: ${String(cause)}`,
							}),
						),
					),
				);
			};

			const fetchEfforts = (
				backend: Backend,
				model: string,
			): Effect.Effect<ReadonlyArray<ModelEffort>, ModelCatalogError> => {
				return harnessRegistry
					.get(backend)
					.listModelEfforts(model)
					.pipe(
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
			): Effect.Effect<ReadonlyArray<ModelEffort>, ModelCatalogError> => {
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

			const list = (
				backend: Backend,
			): Effect.Effect<ReadonlyArray<ModelEntry>, ModelCatalogError> =>
				Effect.gen(function* () {
					const now = Date.now();
					const current = yield* Ref.get(cache);
					const entry = current.get(backend);
					if (entry !== undefined && now - entry.fetchedAt < TTL_MS) {
						return entry.models;
					}
					const models = yield* fetch(backend);
					if (models.length > 0) {
						yield* Ref.update(cache, (m) => {
							const next = new Map(m);
							next.set(backend, { models, fetchedAt: now });
							return next;
						});
					}
					return models;
				});

			const invalidate = (backend: Backend) =>
				Effect.gen(function* () {
					yield* harnessRegistry.get(backend).invalidate();
					yield* Ref.update(cache, (current) => {
						const next = new Map(current);
						next.delete(backend);
						return next;
					});
					if (backend === 'opencode') {
						yield* Ref.set(effortCache, new Map<string, EffortCacheEntry>());
					}
				});

			return { list, listEfforts, invalidate };
		}),
	},
) {
	static readonly layer = Layer.effect(ModelCatalog, ModelCatalog.make).pipe(
		Layer.provide(HarnessRegistry.layer),
	);
}
