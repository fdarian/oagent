import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { AliasPresets } from './alias-presets.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { createTestDatabase } from './test-database.ts';

test('preset snapshots, dirty edits, save, discard, and activation', async () => {
	const database = createTestDatabase();
	try {
		const presets = await Effect.runPromise(
			AliasPresets.make.pipe(
				Effect.provideService(Db, database as unknown as Db['Service']),
			),
		);
		expect(await Effect.runPromise(presets.state())).toEqual({
			presets: [],
			active: null,
			dirty: false,
		});
		database.db
			.insert(schema.modelAliases)
			.values({
				name: 'general',
				backend: 'opencode',
				model_id: 'first',
				description: 'original',
			})
			.run();
		await Effect.runPromise(presets.create(' First '));
		const first = (await Effect.runPromise(presets.state())).active;
		if (first === null) throw new Error('Expected active preset');
		expect(first.name).toBe('First');
		expect(
			database.db.select().from(schema.aliasPresetItems).all()[0]?.model_id,
		).toBe('first');
		database.db
			.update(schema.modelAliases)
			.set({ description: 'edited' })
			.run();
		expect((await Effect.runPromise(presets.state())).dirty).toBe(true);
		await Effect.runPromise(presets.discard());
		expect(
			database.db.select().from(schema.modelAliases).get()?.description,
		).toBe('original');
		database.db.update(schema.modelAliases).set({ model_id: 'saved' }).run();
		await Effect.runPromise(presets.save());
		expect((await Effect.runPromise(presets.state())).dirty).toBe(false);
		await Effect.runPromise(presets.create('Second'));
		database.db.delete(schema.modelAliases).run();
		database.db
			.insert(schema.modelAliases)
			.values({ name: 'other', backend: 'codex', model_id: 'other' })
			.run();
		await Effect.runPromise(presets.activate(first.id));
		expect(
			database.db
				.select()
				.from(schema.modelAliases)
				.all()
				.map((row) => row.name),
		).toEqual(['general']);
		expect(database.db.select().from(schema.modelAliases).get()?.model_id).toBe(
			'saved',
		);
		expect(
			database.db
				.select()
				.from(schema.aliasPresets)
				.where(eq(schema.aliasPresets.active, true))
				.all(),
		).toHaveLength(1);
		expect((await Effect.runPromise(presets.state())).dirty).toBe(false);
		expect(
			await Effect.runPromise(presets.create('First').pipe(Effect.flip)),
		).toMatchObject({ _tag: 'AliasPresetError' });
	} finally {
		database.sqlite.close();
	}
});

test('empty snapshots and typed errors without an active preset', async () => {
	const database = createTestDatabase();
	try {
		const presets = await Effect.runPromise(
			AliasPresets.make.pipe(
				Effect.provideService(Db, database as unknown as Db['Service']),
			),
		);
		for (const operation of [
			presets.save(),
			presets.discard(),
			presets.create('  '),
			presets.activate('missing'),
		]) {
			expect(
				await Effect.runPromise(operation.pipe(Effect.flip)),
			).toMatchObject({ _tag: 'AliasPresetError' });
		}
		await Effect.runPromise(presets.create('Empty'));
		database.db
			.insert(schema.modelAliases)
			.values({ name: 'new', backend: 'opencode', model_id: 'new' })
			.run();
		await Effect.runPromise(presets.discard());
		expect(database.db.select().from(schema.modelAliases).all()).toEqual([]);
	} finally {
		database.sqlite.close();
	}
});
