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

test('dirty comparison ignores insertion order and timestamps but compares every alias field', async () => {
	const database = createTestDatabase();
	try {
		const presets = await Effect.runPromise(
			AliasPresets.make.pipe(
				Effect.provideService(Db, database as unknown as Db['Service']),
			),
		);
		const items = [
			{
				name: 'alpha',
				backend: 'opencode',
				model_id: 'first',
				reasoning_effort: 'low',
				description: 'original',
			},
			{
				name: 'beta',
				backend: 'codex',
				model_id: 'second',
				reasoning_effort: null,
				description: null,
			},
		];
		database.db.insert(schema.modelAliases).values(items).run();
		await Effect.runPromise(presets.create('Original'));
		database.db.delete(schema.modelAliases).run();
		database.db
			.insert(schema.modelAliases)
			.values([...items].reverse())
			.run();
		expect((await Effect.runPromise(presets.state())).dirty).toBe(false);
		for (const change of [
			{ name: 'renamed' },
			{ backend: 'codex' },
			{ model_id: 'different' },
			{ reasoning_effort: null },
			{ description: null },
		]) {
			database.db
				.update(schema.modelAliases)
				.set(change)
				.where(eq(schema.modelAliases.name, 'alpha'))
				.run();
			expect((await Effect.runPromise(presets.state())).dirty).toBe(true);
			await Effect.runPromise(presets.discard());
		}
	} finally {
		database.sqlite.close();
	}
});

test('failed activation rolls back live aliases and active preset', async () => {
	const database = createTestDatabase();
	try {
		const presets = await Effect.runPromise(
			AliasPresets.make.pipe(
				Effect.provideService(Db, database as unknown as Db['Service']),
			),
		);
		database.db
			.insert(schema.modelAliases)
			.values({ name: 'original', backend: 'opencode', model_id: 'first' })
			.run();
		await Effect.runPromise(presets.create('First'));
		const first = (await Effect.runPromise(presets.state())).active;
		if (first === null) throw new Error('Expected active preset');
		database.db.delete(schema.modelAliases).run();
		database.db
			.insert(schema.modelAliases)
			.values({ name: 'second', backend: 'codex', model_id: 'second' })
			.run();
		await Effect.runPromise(presets.create('Second'));
		const before = await Effect.runPromise(presets.state());
		database.sqlite.exec(
			"CREATE TRIGGER reject_restore BEFORE INSERT ON model_aliases WHEN NEW.name = 'original' BEGIN SELECT RAISE(ABORT, 'test restore failure'); END;",
		);
		expect(
			await Effect.runPromise(presets.activate(first.id).pipe(Effect.flip)),
		).toMatchObject({ _tag: 'AliasPresetStorageError' });
		expect(await Effect.runPromise(presets.state())).toEqual(before);
		expect(database.db.select().from(schema.modelAliases).get()?.name).toBe(
			'second',
		);
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
