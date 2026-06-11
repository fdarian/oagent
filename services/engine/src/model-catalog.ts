import { Effect, Ref, Schema } from 'effect';
import { Codex } from './codex.ts';
import { Cursor } from './cursor.ts';
import { Grok } from './grok.ts';
import { OpenCode } from './opencode.ts';

type Backend = 'opencode' | 'cursor' | 'grok' | 'codex';

export type ModelEntry = { id: string; label?: string };

type CacheEntry = {
	models: ReadonlyArray<ModelEntry>;
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

export class ModelCatalog extends Effect.Service<ModelCatalog>()(
	'oagent/ModelCatalog',
	{
		effect: Effect.gen(function* () {
			const opencode = yield* OpenCode;
			const cursor = yield* Cursor;
			const grok = yield* Grok;
			const codex = yield* Codex;
			const cache = yield* Ref.make(new Map<Backend, CacheEntry>());

			const fetch = (
				backend: Backend,
			): Effect.Effect<ReadonlyArray<ModelEntry>, ModelCatalogError> => {
				const inner = (() => {
					if (backend === 'opencode') return opencode.listModels();
					if (backend === 'grok') return grok.listModels();
					if (backend === 'codex') return codex.listModels();
					return cursor.listModels();
				})();
				return inner.pipe(
					Effect.catchAll((cause) =>
						Effect.fail(
							new ModelCatalogError({
								backend,
								message: `Failed to list models for ${backend}: ${String(cause)}`,
							}),
						),
					),
				);
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
					yield* Ref.update(cache, (m) => {
						const next = new Map(m);
						next.set(backend, { models, fetchedAt: now });
						return next;
					});
					return models;
				});

			return { list };
		}),
		dependencies: [OpenCode.Default, Cursor.Default, Grok.Default, Codex.Default],
	},
) {}
