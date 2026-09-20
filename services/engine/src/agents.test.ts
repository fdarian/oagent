import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Effect, Layer } from 'effect';
import {
	AgentNotMappedForBackend,
	Agents,
	AgentTypeNotFound,
} from './agents.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';

function createAgentsLayer() {
	const sqlite = new Database(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON;');
	sqlite.exec(`
		CREATE TABLE agents (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			name text NOT NULL,
			created_at integer NOT NULL,
			updated_at integer NOT NULL
		);
		CREATE UNIQUE INDEX agents_name_uq ON agents (name);
		CREATE TABLE agent_harness_targets (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			agent_id integer NOT NULL,
			backend text NOT NULL,
			target text NOT NULL,
			created_at integer NOT NULL,
			updated_at integer NOT NULL,
			FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE
		);
		CREATE UNIQUE INDEX agent_harness_targets_agent_id_backend_uq
			ON agent_harness_targets (agent_id, backend);
	`);
	const db = drizzle(sqlite, { schema });
	return Layer.effect(Agents, Agents.make).pipe(
		Layer.provide(Layer.succeed(Db, { db, sqlite })),
	);
}

describe('Agents', () => {
	test('saves, replaces, lists, resolves, and deletes definitions', async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const agents = yield* Agents;
				expect(agents.list()).toEqual([]);

				expect(
					agents.save({
						name: 'reviewer',
						targets: [{ backend: 'opencode', target: 'plan' }],
					}),
				).toEqual({
					name: 'reviewer',
					targets: [{ backend: 'opencode', target: 'plan' }],
				});
				expect(yield* agents.resolve('reviewer', 'opencode')).toBe('plan');

				agents.save({
					name: 'reviewer',
					targets: [{ backend: 'opencode', target: 'build' }],
				});
				expect(agents.list()).toEqual([
					{
						name: 'reviewer',
						targets: [{ backend: 'opencode', target: 'build' }],
					},
				]);

				expect(agents.delete('reviewer')).toBe(true);
				expect(agents.delete('reviewer')).toBe(false);
				expect(agents.list()).toEqual([]);
			}).pipe(Effect.provide(createAgentsLayer())),
		);
	});

	test('distinguishes unknown agent types from missing backend mappings', async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const agents = yield* Agents;
				agents.save({ name: 'reviewer', targets: [] });
				agents.save({ name: 'builder', targets: [] });

				const notFound = yield* Effect.flip(
					agents.resolve('missing', 'opencode'),
				);
				expect(notFound).toBeInstanceOf(AgentTypeNotFound);
				if (notFound._tag !== 'AgentTypeNotFound') {
					return yield* Effect.die(
						new Error(`Expected AgentTypeNotFound, received ${notFound._tag}`),
					);
				}
				expect(notFound.configuredAgentTypes).toEqual(['builder', 'reviewer']);
				expect(notFound.message).toContain('builder');
				expect(notFound.message).toContain('reviewer');

				const notMapped = yield* Effect.flip(
					agents.resolve('reviewer', 'cursor'),
				);
				expect(notMapped).toBeInstanceOf(AgentNotMappedForBackend);
				expect(notMapped.message).toContain('reviewer');
				expect(notMapped.message).toContain('cursor');
			}).pipe(Effect.provide(createAgentsLayer())),
		);
	});
});
