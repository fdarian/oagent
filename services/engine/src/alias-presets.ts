import { eq } from 'drizzle-orm';
import { Context, Effect, Layer, Schema } from 'effect';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';

export class AliasPresetError extends Schema.TaggedError<AliasPresetError>()(
	'AliasPresetError',
	{
		message: Schema.String,
	},
) {}

export class AliasPresetStorageError extends Schema.TaggedError<AliasPresetStorageError>()(
	'AliasPresetStorageError',
	{
		cause: Schema.Defect(),
	},
) {}

const columns = {
	name: schema.modelAliases.name,
	backend: schema.modelAliases.backend,
	model_id: schema.modelAliases.model_id,
	reasoning_effort: schema.modelAliases.reasoning_effort,
	description: schema.modelAliases.description,
};

function aliasValues(
	row:
		| typeof schema.modelAliases.$inferSelect
		| typeof schema.aliasPresetItems.$inferSelect,
) {
	return {
		name: row.name,
		backend: row.backend,
		model_id: row.model_id,
		reasoning_effort: row.reasoning_effort,
		description: row.description,
	};
}

export class AliasPresets extends Context.Service<AliasPresets>()(
	'oagent/AliasPresets',
	{
		make: Effect.gen(function* () {
			const database = yield* Db;
			const db = database.db;
			const readActive = () =>
				db
					.select()
					.from(schema.aliasPresets)
					.where(eq(schema.aliasPresets.active, true))
					.get();
			const snapshot = (presetId: number) => {
				db.delete(schema.aliasPresetItems)
					.where(eq(schema.aliasPresetItems.preset_id, presetId))
					.run();
				const items = db.select().from(schema.modelAliases).all();
				if (items.length > 0)
					db.insert(schema.aliasPresetItems)
						.values(
							items.map((item) => ({
								...aliasValues(item),
								preset_id: presetId,
							})),
						)
						.run();
				db.update(schema.aliasPresets)
					.set({ updated_at: new Date() })
					.where(eq(schema.aliasPresets.id, presetId))
					.run();
			};
			const restore = (presetId: number) => {
				const items = db
					.select()
					.from(schema.aliasPresetItems)
					.where(eq(schema.aliasPresetItems.preset_id, presetId))
					.all();
				db.delete(schema.modelAliases).run();
				if (items.length > 0)
					db.insert(schema.modelAliases).values(items.map(aliasValues)).run();
				db.update(schema.aliasPresets).set({ active: false }).run();
				db.update(schema.aliasPresets)
					.set({ active: true, updated_at: new Date() })
					.where(eq(schema.aliasPresets.id, presetId))
					.run();
			};
			const storage = <A>(operation: () => A) =>
				Effect.try({
					try: operation,
					catch: (cause) => new AliasPresetStorageError({ cause }),
				});
			const state = () =>
				storage(() =>
					db.transaction(() => {
						const presets = db
							.select()
							.from(schema.aliasPresets)
							.orderBy(schema.aliasPresets.name)
							.all();
						const active = presets.find((preset) => preset.active);
						const live = db
							.select(columns)
							.from(schema.modelAliases)
							.orderBy(schema.modelAliases.name)
							.all();
						const items =
							active === undefined
								? []
								: db
										.select()
										.from(schema.aliasPresetItems)
										.where(eq(schema.aliasPresetItems.preset_id, active.id))
										.orderBy(schema.aliasPresetItems.name)
										.all()
										.map(aliasValues);
						return {
							presets: presets.map((preset) => ({
								id: preset.uuid,
								name: preset.name,
							})),
							active:
								active === undefined
									? null
									: { id: active.uuid, name: active.name },
							dirty:
								active !== undefined &&
								JSON.stringify(live) !== JSON.stringify(items),
						};
					}),
				);
			const create = (input: string) =>
				Effect.gen(function* () {
					const name = input.trim();
					if (name.length === 0)
						return yield* new AliasPresetError({
							message: 'Preset name must not be empty',
						});
					return yield* storage(() =>
						db.transaction(() => {
							if (
								db
									.select()
									.from(schema.aliasPresets)
									.where(eq(schema.aliasPresets.name, name))
									.get() !== undefined
							)
								return false;
							db.update(schema.aliasPresets).set({ active: false }).run();
							const preset = db
								.insert(schema.aliasPresets)
								.values({ uuid: Bun.randomUUIDv7(), name, active: true })
								.returning()
								.get();
							snapshot(preset.id);
							return true;
						}),
					).pipe(
						Effect.flatMap((created) =>
							created
								? Effect.void
								: new AliasPresetError({
										message: `Preset "${name}" already exists`,
									}),
						),
					);
				});
			const activate = (id: string) =>
				storage(() =>
					db.transaction(() => {
						const preset = db
							.select()
							.from(schema.aliasPresets)
							.where(eq(schema.aliasPresets.uuid, id))
							.get();
						if (preset === undefined) return false;
						restore(preset.id);
						return true;
					}),
				).pipe(
					Effect.flatMap((found) =>
						found
							? Effect.void
							: new AliasPresetError({ message: 'Preset not found' }),
					),
				);
			const updateActive = (operation: (id: number) => void) =>
				storage(() =>
					db.transaction(() => {
						const active = readActive();
						if (active === undefined) return false;
						operation(active.id);
						return true;
					}),
				).pipe(
					Effect.flatMap((found) =>
						found
							? Effect.void
							: new AliasPresetError({ message: 'No active preset' }),
					),
				);
			return {
				state,
				create,
				activate,
				save: () => updateActive(snapshot),
				discard: () => updateActive(restore),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(AliasPresets, AliasPresets.make).pipe(
		Layer.provide(Db.layer),
	);
}
