import { eq } from 'drizzle-orm';
import { Context, Effect, Layer, Schema } from 'effect';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';

export class HarnessVersionError extends Schema.TaggedError<HarnessVersionError>()(
	'HarnessVersionError',
	{
		operation: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		const detail =
			this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `${this.operation} failed: ${detail}`;
	}
}

export class HarnessVersion extends Context.Service<HarnessVersion>()(
	'oagent/HarnessVersion',
	{
		make: Effect.gen(function* () {
			const dbService = yield* Db;

			const get = (
				backend: string,
			): Effect.Effect<string | undefined, HarnessVersionError> =>
				Effect.try({
					try: () => {
						const row = dbService.db
							.select({ version: schema.harnesses.version })
							.from(schema.harnesses)
							.where(eq(schema.harnesses.backend, backend))
							.limit(1)
							.get();
						return row === undefined || row.version === null
							? undefined
							: row.version;
					},
					catch: (cause) =>
						new HarnessVersionError({ operation: 'get', cause }),
				});

			const set = (
				backend: string,
				version: string | undefined,
			): Effect.Effect<void, HarnessVersionError> =>
				Effect.try({
					try: () => {
						dbService.db
							.update(schema.harnesses)
							.set({ version: version === undefined ? null : version })
							.where(eq(schema.harnesses.backend, backend))
							.run();
					},
					catch: (cause) =>
						new HarnessVersionError({ operation: 'set', cause }),
				});

			return { get, set };
		}),
	},
) {
	static readonly layer = Layer.effect(
		HarnessVersion,
		HarnessVersion.make,
	).pipe(Layer.provide(Db.layer));
}
