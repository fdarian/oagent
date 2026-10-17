import { eq } from 'drizzle-orm';
import { Context, Effect, Exit, Layer, Schema, Scope, Semaphore } from 'effect';
import { makeAcpAdapterHarness } from './acp-harness.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import {
	type Harness,
	type HarnessId,
	isCustomHarnessIdFormat,
	isReservedHarnessId,
	UnknownHarness,
} from './harness.ts';
import { Settings } from './settings.ts';

export type CustomHarnessDefinition = {
	readonly id: HarnessId;
	readonly name: string;
	readonly binary: string;
	readonly args: ReadonlyArray<string>;
	readonly createdAt: Date;
	readonly updatedAt: Date;
};

export type CustomHarnessInput = {
	readonly id: HarnessId;
	readonly name: string;
	readonly binary: string;
	readonly args: ReadonlyArray<string>;
};

export class CustomHarnessError extends Schema.TaggedError<CustomHarnessError>()(
	'CustomHarnessError',
	{
		code: Schema.Literals([
			'INVALID_ID',
			'RESERVED_ID',
			'ALREADY_EXISTS',
			'INVALID_DEFINITION',
		]),
		message: Schema.String,
	},
) {}

/** The part of a definition that determines how its ACP subprocess is launched. */
type LaunchSpec = {
	readonly id: HarnessId;
	readonly binary: string;
	readonly args: ReadonlyArray<string>;
};

type Instance = {
	readonly harness: Harness;
	readonly scope: Scope.Closeable;
};

const toDefinition = (
	row: typeof schema.customHarnesses.$inferSelect,
): CustomHarnessDefinition => ({
	id: row.id,
	name: row.name,
	binary: row.binary,
	args: row.args,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
});

const validateFields = (input: Omit<CustomHarnessInput, 'id'>) =>
	input.name.trim().length === 0
		? new CustomHarnessError({
				code: 'INVALID_DEFINITION',
				message: 'Harness name is required.',
			})
		: input.binary.trim().length === 0
			? new CustomHarnessError({
					code: 'INVALID_DEFINITION',
					message: 'Harness command is required.',
				})
			: Effect.void;

export const validateCustomHarnessId = (id: string) => {
	if (!isCustomHarnessIdFormat(id)) {
		return new CustomHarnessError({
			code: 'INVALID_ID',
			message: `Harness id "${id}" is invalid. Use 1-32 lowercase letters, digits or hyphens, starting with a letter.`,
		});
	}
	if (isReservedHarnessId(id)) {
		return new CustomHarnessError({
			code: 'RESERVED_ID',
			message: `Harness id "${id}" is reserved.`,
		});
	}
	return Effect.void;
};

export class CustomHarnesses extends Context.Service<CustomHarnesses>()(
	'oagent/CustomHarnesses',
	{
		make: Effect.gen(function* () {
			const db = (yield* Db).db;
			const settings = yield* Settings;
			const lock = yield* Semaphore.make(1);

			// Each instance owns a scope, so its ACP connection (an RcRef inside
			// `AcpAgent`) lives and dies with the definition it was built from.
			// Slice 2 adds inline `--acp` definitions to this same cache, keyed by
			// a hash of binary+args instead of a saved id.
			const instances = new Map<string, Instance>();

			const closeInstance = (instance: Instance) =>
				Scope.close(instance.scope, Exit.succeed(undefined));

			const buildInstance = (spec: LaunchSpec) =>
				Effect.gen(function* () {
					const adapter = makeAcpAdapterHarness({
						backend: spec.id,
						defaultBinary: spec.binary,
						args: spec.args,
					});
					const scope = yield* Scope.make();
					const harness = yield* Layer.buildWithScope(
						adapter.acpLayer,
						scope,
					).pipe(
						Effect.flatMap((context) =>
							adapter.make.pipe(Effect.provide(context)),
						),
						Effect.provideService(Settings, settings),
						Effect.onError(() => Scope.close(scope, Exit.succeed(undefined))),
					);
					const instance: Instance = { harness, scope };
					return instance;
				});

			const acquireInstance = (key: string, spec: LaunchSpec) =>
				Effect.gen(function* () {
					const existing = instances.get(key);
					if (existing !== undefined) return existing.harness;
					const built = yield* buildInstance(spec);
					instances.set(key, built);
					return built.harness;
				});

			const dropInstance = (key: string) =>
				Effect.gen(function* () {
					const existing = instances.get(key);
					if (existing === undefined) return;
					instances.delete(key);
					yield* closeInstance(existing);
				});

			yield* Effect.addFinalizer(() =>
				Effect.forEach(
					Array.from(instances.values()),
					(instance) => closeInstance(instance),
					{ discard: true },
				).pipe(Effect.tap(() => Effect.sync(() => instances.clear()))),
			);

			const findRow = (id: HarnessId) =>
				isCustomHarnessIdFormat(id)
					? db
							.select()
							.from(schema.customHarnesses)
							.where(eq(schema.customHarnesses.id, id))
							.limit(1)
							.get()
					: undefined;

			const list = (): ReadonlyArray<CustomHarnessDefinition> =>
				db
					.select()
					.from(schema.customHarnesses)
					.orderBy(schema.customHarnesses.created_at)
					.all()
					.map(toDefinition);

			const get = (id: HarnessId) =>
				Effect.suspend(() => {
					const row = findRow(id);
					return row === undefined
						? Effect.fail(new UnknownHarness({ harnessId: id }))
						: Effect.succeed(toDefinition(row));
				});

			const resolve = (id: HarnessId) =>
				lock.withPermit(
					Effect.gen(function* () {
						const definition = yield* get(id);
						return yield* acquireInstance(definition.id, definition);
					}),
				);

			const resolveAll = () =>
				lock.withPermit(
					Effect.forEach(list(), (definition) =>
						acquireInstance(definition.id, definition),
					),
				);

			const create = (input: CustomHarnessInput) =>
				Effect.gen(function* () {
					yield* validateCustomHarnessId(input.id);
					yield* validateFields(input);
					if (findRow(input.id) !== undefined) {
						return yield* new CustomHarnessError({
							code: 'ALREADY_EXISTS',
							message: `A harness with id "${input.id}" already exists.`,
						});
					}
					const now = new Date();
					db.insert(schema.customHarnesses)
						.values({
							id: input.id,
							name: input.name.trim(),
							binary: input.binary.trim(),
							args: [...input.args],
							created_at: now,
							updated_at: now,
						})
						.run();
					return yield* get(input.id);
				});

			const update = (input: CustomHarnessInput) =>
				lock.withPermit(
					Effect.gen(function* () {
						yield* get(input.id);
						yield* validateFields(input);
						db.update(schema.customHarnesses)
							.set({
								name: input.name.trim(),
								binary: input.binary.trim(),
								args: [...input.args],
								updated_at: new Date(),
							})
							.where(eq(schema.customHarnesses.id, input.id))
							.run();
						yield* dropInstance(input.id);
						return yield* get(input.id);
					}),
				);

			const remove = (id: HarnessId) =>
				lock.withPermit(
					Effect.gen(function* () {
						yield* get(id);
						db.transaction((tx) => {
							tx.delete(schema.harnesses)
								.where(eq(schema.harnesses.backend, id))
								.run();
							tx.delete(schema.customHarnesses)
								.where(eq(schema.customHarnesses.id, id))
								.run();
						});
						settings.setHarnessEnv(id, {});
						yield* dropInstance(id);
					}),
				);

			return { list, get, create, update, remove, resolve, resolveAll };
		}),
	},
) {
	static readonly layer = Layer.effect(
		CustomHarnesses,
		CustomHarnesses.make,
	).pipe(Layer.provide(Db.layer), Layer.provide(Settings.layer));
}
