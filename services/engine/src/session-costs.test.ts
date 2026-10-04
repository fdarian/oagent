import { describe, expect, spyOn, test } from 'bun:test';
import * as ccusage from 'ccusage-lib';
import { eq } from 'drizzle-orm';
import { Effect, Exit } from 'effect';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { SessionCosts } from './session-costs.ts';
import { Settings } from './settings.ts';
import { createTestDatabase } from './test-database.ts';

const tokens = {
	inputTokens: 100,
	outputTokens: 20,
	cacheCreationTokens: 30,
	cacheReadTokens: 40,
};
const cost = { ...tokens, totalCostUsd: 1.23 };

function withCosts(
	backend: string,
	run: (services: {
		costs: SessionCosts['Service'];
		settings: Settings['Service'];
		database: ReturnType<typeof createTestDatabase>;
		session: typeof schema.sessions.$inferSelect;
	}) => Effect.Effect<void, unknown>,
) {
	const database = createTestDatabase();
	return Effect.gen(function* () {
		const session = database.db
			.insert(schema.sessions)
			.values({
				uuid: 'session',
				title: 'Test',
				backend,
				cwd: '/test',
				harness_session_id: 'harness-id',
			})
			.returning()
			.get();
		const dbService = { db: database.db, sqlite: database.sqlite };
		const settings = yield* Settings.make.pipe(
			Effect.provideService(Db, dbService),
		);
		settings.setCodexHome('/test/codex-home');
		const costs = yield* SessionCosts.make.pipe(
			Effect.provideService(Db, dbService),
			Effect.provideService(Settings, settings),
		);
		yield* run({ costs, settings, database, session });
	}).pipe(Effect.ensuring(Effect.sync(() => database.sqlite.close())));
}

function mockCommand(error?: Error) {
	return spyOn(ccusage, 'sessionCost').mockImplementation(async () => {
		await Bun.sleep(30);
		if (error !== undefined) throw error;
		return cost;
	});
}

describe('SessionCosts', () => {
	for (const backend of ['claude', 'codex', 'opencode'] as const) {
		test(`${backend}: deduplicates, caches and refreshes after a turn`, async () => {
			const command = mockCommand();
			await Effect.runPromise(
				withCosts(backend, (services) =>
					Effect.gen(function* () {
						const results = yield* Effect.all(
							[services.costs.get('session'), services.costs.get('session')],
							{ concurrency: 'unbounded' },
						);
						expect(command).toHaveBeenCalledTimes(1);
						expect(results[0]).toEqual(results[1]);
						expect(results[0]).toMatchObject({
							status: 'ready',
							...cost,
							stale: false,
						});
						const args = command.mock.calls[0];
						expect(args?.[0]).toEqual({
							harness: backend,
							sessionId: 'harness-id',
							env:
								backend === 'codex'
									? { CODEX_HOME: '/test/codex-home' }
									: undefined,
						});
						yield* services.costs.get('session');
						expect(command).toHaveBeenCalledTimes(1);
						const job = services.database.db
							.insert(schema.jobs)
							.values({
								uuid: 'job',
								session_id: services.session.id,
								status: 'running',
								prompt: 'Test',
							})
							.returning()
							.get();
						expect(yield* services.costs.get('session')).toMatchObject({
							stale: true,
						});
						expect(command).toHaveBeenCalledTimes(1);
						yield* Effect.sleep(5);
						services.database.db
							.update(schema.jobs)
							.set({ status: 'done', terminated_at: new Date() })
							.where(eq(schema.jobs.id, job.id))
							.run();
						expect(yield* services.costs.get('session')).toMatchObject({
							stale: false,
						});
						expect(command).toHaveBeenCalledTimes(2);
						expect(
							services.database.db.select().from(schema.sessionCosts).all(),
						).toHaveLength(1);
					}),
				).pipe(Effect.ensuring(Effect.sync(() => command.mockRestore()))),
			);
		});
	}

	for (const backend of ['grok', 'cursor']) {
		test(`${backend}: unsupported without invoking ccusage`, async () => {
			const command = mockCommand();
			await Effect.runPromise(
				withCosts(backend, (services) =>
					Effect.gen(function* () {
						expect(yield* services.costs.get('session')).toEqual({
							status: 'unsupported',
						});
						expect(command).not.toHaveBeenCalled();
					}),
				).pipe(Effect.ensuring(Effect.sync(() => command.mockRestore()))),
			);
		});
	}

	for (const scenario of ['command failure', 'invalid response', 'missing']) {
		test(`${scenario}: typed error, no cache, retry allowed`, async () => {
			const command = mockCommand(
				scenario === 'missing'
					? new ccusage.SessionNotFoundError('opencode', 'harness-id')
					: new Error(scenario),
			);
			await Effect.runPromise(
				withCosts('opencode', (services) =>
					Effect.gen(function* () {
						const result = yield* Effect.exit(services.costs.get('session'));
						expect(Exit.isFailure(result)).toBe(true);
						if (Exit.isFailure(result))
							expect(Exit.findErrorOption(result)).toMatchObject({
								value: { _tag: 'SessionCostError' },
							});
						expect(
							services.database.db.select().from(schema.sessionCosts).all(),
						).toHaveLength(0);
						yield* Effect.exit(services.costs.get('session'));
						expect(command).toHaveBeenCalledTimes(2);
					}),
				).pipe(Effect.ensuring(Effect.sync(() => command.mockRestore()))),
			);
		});
	}

	for (const backend of ['claude', 'codex', 'opencode'] as const) {
		test(`${backend}: not-found response names the backend and does not cache zeros`, async () => {
			const command = mockCommand(
				new ccusage.SessionNotFoundError(backend, 'harness-id'),
			);
			await Effect.runPromise(
				withCosts(backend, (services) =>
					Effect.gen(function* () {
						const result = yield* Effect.exit(services.costs.get('session'));
						expect(Exit.isFailure(result)).toBe(true);
						if (Exit.isFailure(result))
							expect(Exit.findErrorOption(result)).toMatchObject({
								value: {
									_tag: 'SessionCostError',
									message: `No ${backend} session found with ID: harness-id`,
								},
							});
						expect(
							services.database.db.select().from(schema.sessionCosts).all(),
						).toHaveLength(0);
					}),
				).pipe(Effect.ensuring(Effect.sync(() => command.mockRestore()))),
			);
		});

		test(`${backend}: library failures retain their cause and message`, async () => {
			const cause = new Error('Download failed');
			const command = mockCommand(cause);
			await Effect.runPromise(
				withCosts(backend, (services) =>
					Effect.gen(function* () {
						const result = yield* Effect.exit(services.costs.get('session'));
						expect(Exit.isFailure(result)).toBe(true);
						if (Exit.isFailure(result))
							expect(Exit.findErrorOption(result)).toMatchObject({
								value: {
									_tag: 'SessionCostError',
									message: `Could not compute ${backend} session cost: Download failed`,
									cause,
								},
							});
					}),
				).pipe(Effect.ensuring(Effect.sync(() => command.mockRestore()))),
			);
		});
	}

	test('Codex inherits the environment when no home is configured', async () => {
		const command = mockCommand();
		await Effect.runPromise(
			withCosts('codex', (services) =>
				Effect.gen(function* () {
					services.settings.setCodexHome(null);
					expect(yield* services.costs.get('session')).toMatchObject({
						status: 'ready',
					});
					expect(command.mock.calls[0]?.[0]?.env).toBeUndefined();
				}),
			).pipe(Effect.ensuring(Effect.sync(() => command.mockRestore()))),
		);
	});

	test('unknown session and absent harness ID are typed errors', async () => {
		const command = mockCommand();
		await Effect.runPromise(
			withCosts('codex', (services) =>
				Effect.gen(function* () {
					expect(
						Exit.isFailure(yield* Effect.exit(services.costs.get('unknown'))),
					).toBe(true);
					services.database.db
						.update(schema.sessions)
						.set({ harness_session_id: null })
						.run();
					expect(
						Exit.isFailure(yield* Effect.exit(services.costs.get('session'))),
					).toBe(true);
					expect(command).not.toHaveBeenCalled();
				}),
			).pipe(Effect.ensuring(Effect.sync(() => command.mockRestore()))),
		);
	});

	test('a turn ending during the scan leaves a stale snapshot that is recomputed', async () => {
		const command = mockCommand();
		await Effect.runPromise(
			withCosts('codex', (services) =>
				Effect.gen(function* () {
					const job = services.database.db
						.insert(schema.jobs)
						.values({
							uuid: 'job',
							session_id: services.session.id,
							status: 'running',
							prompt: 'Test',
						})
						.returning()
						.get();
					const requests = Effect.all(
						[
							services.costs.get('session'),
							Effect.gen(function* () {
								yield* Effect.sleep(10);
								services.database.db
									.update(schema.jobs)
									.set({ status: 'done', terminated_at: new Date() })
									.where(eq(schema.jobs.id, job.id))
									.run();
							}),
						],
						{ concurrency: 'unbounded' },
					);
					const results = yield* requests;
					expect(results[0]).toMatchObject({ status: 'ready', stale: true });
					expect(yield* services.costs.get('session')).toMatchObject({
						stale: false,
					});
					expect(command).toHaveBeenCalledTimes(2);
				}),
			).pipe(Effect.ensuring(Effect.sync(() => command.mockRestore()))),
		);
	});

	test('an interrupted waiter does not evict the active computation', async () => {
		const command = mockCommand();
		await Effect.runPromise(
			withCosts('codex', (services) =>
				Effect.gen(function* () {
					const results = yield* Effect.all(
						[
							services.costs.get('session'),
							services.costs
								.get('session')
								.pipe(Effect.timeout(10), Effect.exit),
						],
						{ concurrency: 'unbounded' },
					);
					expect(results[0]).toMatchObject({ status: 'ready' });
					expect(Exit.isFailure(results[1])).toBe(true);
					expect(command).toHaveBeenCalledTimes(1);
					yield* services.costs.get('session');
					expect(command).toHaveBeenCalledTimes(1);
				}),
			).pipe(Effect.ensuring(Effect.sync(() => command.mockRestore()))),
		);
	});

	test('interrupting the computing caller cleans up and allows retry', async () => {
		const command = mockCommand();
		await Effect.runPromise(
			withCosts('codex', (services) =>
				Effect.gen(function* () {
					const result = yield* services.costs
						.get('session')
						.pipe(Effect.timeout(10), Effect.exit);
					expect(Exit.isFailure(result)).toBe(true);
					expect(
						services.database.db.select().from(schema.sessionCosts).all(),
					).toHaveLength(0);
					expect(yield* services.costs.get('session')).toMatchObject({
						status: 'ready',
					});
					expect(command).toHaveBeenCalledTimes(2);
				}),
			).pipe(Effect.ensuring(Effect.sync(() => command.mockRestore()))),
		);
	});
});
