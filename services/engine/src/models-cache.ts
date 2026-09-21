import { Effect, Ref } from 'effect';

const TTL_MS = 5 * 60 * 1000;

type CacheEntry<A> = {
	values: ReadonlyArray<A>;
	fetchedAt: number;
};

export type ModelsCache<A, E, R> = {
	get: () => Effect.Effect<ReadonlyArray<A>, E, R>;
	invalidate: () => Effect.Effect<void, never, never>;
};

export type KeyedModelsCache<A, E, R> = {
	get: (key: string) => Effect.Effect<ReadonlyArray<A>, E, R>;
	invalidate: () => Effect.Effect<void, never, never>;
};

export const ModelsCache = {
	make: <A, E, R>(
		fetch: () => Effect.Effect<ReadonlyArray<A>, E, R>,
	): Effect.Effect<ModelsCache<A, E, R>, never, never> =>
		Effect.gen(function* () {
			const cache = yield* Ref.make<CacheEntry<A> | undefined>(undefined);

			const get = (): Effect.Effect<ReadonlyArray<A>, E, R> =>
				Effect.gen(function* () {
					const now = Date.now();
					const current = yield* Ref.get(cache);
					if (current !== undefined && now - current.fetchedAt < TTL_MS) {
						return current.values;
					}

					const values = yield* fetch();
					yield* Ref.set(cache, { values, fetchedAt: now });
					return values;
				});

			const invalidate = () => Ref.set(cache, undefined);

			return { get, invalidate };
		}),
	makeKeyed: <A, E, R>(
		fetch: (key: string) => Effect.Effect<ReadonlyArray<A>, E, R>,
	): Effect.Effect<KeyedModelsCache<A, E, R>, never, never> =>
		Effect.gen(function* () {
			const cache = yield* Ref.make(new Map<string, CacheEntry<A>>());

			const get = (key: string): Effect.Effect<ReadonlyArray<A>, E, R> =>
				Effect.gen(function* () {
					const now = Date.now();
					const current = yield* Ref.get(cache);
					const entry = current.get(key);
					if (entry !== undefined && now - entry.fetchedAt < TTL_MS) {
						return entry.values;
					}

					const values = yield* fetch(key);
					yield* Ref.update(cache, (previous) => {
						const next = new Map(previous);
						next.set(key, { values, fetchedAt: now });
						return next;
					});
					return values;
				});

			const invalidate = () => Ref.set(cache, new Map());

			return { get, invalidate };
		}),
};
