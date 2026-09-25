import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Effect, Fiber } from 'effect';
import { Agents } from './agents.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import type { Harness } from './harness.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { Jobs } from './jobs.ts';
import { Settings } from './settings.ts';
import { createTestDatabase } from './test-database.ts';
import { Worktrees } from './worktree.ts';

function createDatabase() {
	return createTestDatabase();
}

function insertSession(
	database: ReturnType<typeof createDatabase>,
	input: { uuid: string; title: string; cwd: string; backend?: string },
) {
	const session = database.db
		.insert(schema.sessions)
		.values({
			uuid: input.uuid,
			title: input.title,
			backend: input.backend ?? 'opencode',
			cwd: input.cwd,
		})
		.returning()
		.get();
	if (session === undefined) throw new Error('Expected inserted session');
	return session;
}

function createHarnessRegistry(harness: Harness): HarnessRegistry['Service'] {
	return {
		all: [harness],
		get: () => harness,
		listAgentTargets: () => Effect.succeed([]),
	};
}

describe('job event persistence', () => {
	test('does not persist the same replayed ACP update twice', async () => {
		const database = createDatabase();
		const event = {
			sessionUpdate: 'agent_message_chunk' as const,
			messageId: 'msg_replayed',
			content: { type: 'text' as const, text: 'same update' },
		};
		const metadataEvent = {
			...event,
			_meta: { source: 'different-update' },
		};
		const steerMetadataEvent = {
			...event,
			_meta: { 'oagent/steer': true },
		};
		const harness = {
			backend: 'opencode' as const,
			runTurn: (input: { onEvent?: (value: typeof event) => void }) =>
				Effect.sync(() => {
					input.onEvent?.(event);
					input.onEvent?.(event);
					input.onEvent?.(steerMetadataEvent as typeof event);
					input.onEvent?.(metadataEvent as typeof event);
					return {
						sessionId: 'ses_test',
						text: 'same update',
						stopReason: 'end_turn',
					};
				}),
		} as unknown as Harness;
		const dbService = {
			db: database.db,
			sqlite: database.sqlite,
		} as unknown as Db['Service'];
		const jobs = await Effect.runPromise(
			Jobs.make.pipe(
				Effect.provideService(Db, dbService),
				Effect.provideService(HarnessRegistry, createHarnessRegistry(harness)),
				Effect.provideService(Settings, {
					getSetting: () => undefined,
				} as unknown as Settings['Service']),
				Effect.provideService(Agents, {} as Agents['Service']),
				Effect.provideService(Worktrees, {} as Worktrees['Service']),
			),
		);
		const session = insertSession(database, {
			uuid: 'session-events',
			title: 'Event session',
			cwd: '/tmp',
		});

		const started = await Effect.runPromise(
			jobs.start({
				session,
				prompt: 'run',
				model: 'opencode:test',
			}),
		);
		await Effect.runPromise(
			jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
		);

		const page = jobs.readEventsPage(started.jobId, 0, 100);
		expect(page.events).toHaveLength(2);
		expect(page.events[0]?.event).toMatchObject(event);
		expect(page.events[1]?.event).toMatchObject(metadataEvent);
		database.sqlite.close();
	});
});

test('starts in a worktree and resumes the session in the same path', async () => {
	const database = createDatabase();
	const cwdValues: string[] = [];
	const branches: string[] = [];
	const harness = {
		backend: 'opencode' as const,
		runTurn: (input: { cwd: string }) =>
			Effect.sync(() => {
				cwdValues.push(input.cwd);
				return {
					sessionId: 'ses_worktree',
					text: 'done',
					stopReason: 'end_turn',
				};
			}),
	} as unknown as Harness;
	const jobs = await Effect.runPromise(
		Jobs.make.pipe(
			Effect.provideService(Db, {
				db: database.db,
				sqlite: database.sqlite,
			} as unknown as Db['Service']),
			Effect.provideService(HarnessRegistry, createHarnessRegistry(harness)),
			Effect.provideService(Settings, {
				getSetting: () => undefined,
			} as unknown as Settings['Service']),
			Effect.provideService(Agents, {} as Agents['Service']),
			Effect.provideService(Worktrees, {
				create: (_cwd: string, branch: string) => {
					branches.push(branch);
					return Effect.succeed('/repo-worktree/apps/web');
				},
			} as Worktrees['Service']),
		),
	);
	const session = insertSession(database, {
		uuid: 'session-worktree',
		title: 'Worktree session',
		cwd: '/repo/apps/web',
	});
	const first = await Effect.runPromise(
		jobs.start({
			session,
			prompt: 'first',
			model: 'opencode:test',
			worktree: true,
		}),
	);
	await Effect.runPromise(jobs.wait({ jobId: first.jobId, timeoutMs: 1_000 }));
	const resumedSession = database.db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.uuid, 'session-worktree'))
		.get();
	if (resumedSession === undefined) throw new Error('Expected resumed session');
	const second = await Effect.runPromise(
		jobs.start({
			session: resumedSession,
			prompt: 'continue',
			model: 'opencode:test',
			worktree: true,
		}),
	);
	await Effect.runPromise(jobs.wait({ jobId: second.jobId, timeoutMs: 1_000 }));
	expect(branches).toEqual([`oagent/${first.jobId.slice(-8)}`]);
	expect(cwdValues).toEqual([
		'/repo-worktree/apps/web',
		'/repo-worktree/apps/web',
	]);
	expect(second.worktreePath).toBe(first.worktreePath);
	expect(second.worktreeBranch).toBe(`oagent/${first.jobId.slice(-8)}`);
	expect(jobs.getJobMetadata(second.jobId)).toMatchObject({
		cwd: '/repo-worktree/apps/web',
		worktreePath: '/repo-worktree/apps/web',
		worktreeBranch: `oagent/${first.jobId.slice(-8)}`,
	});
	database.sqlite.close();
});

test('cancel during worktree creation never starts the reserved turn', async () => {
	const database = createDatabase();
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<string>();
	let runs = 0;
	const harness = {
		backend: 'opencode' as const,
		runTurn: () =>
			Effect.sync(() => {
				runs += 1;
				return {
					sessionId: 'ses_cancelled',
					text: 'done',
					stopReason: 'end_turn',
				};
			}),
	} as unknown as Harness;
	const jobs = await Effect.runPromise(
		Jobs.make.pipe(
			Effect.provideService(Db, {
				db: database.db,
				sqlite: database.sqlite,
			} as unknown as Db['Service']),
			Effect.provideService(HarnessRegistry, createHarnessRegistry(harness)),
			Effect.provideService(Settings, {
				getSetting: () => undefined,
			} as unknown as Settings['Service']),
			Effect.provideService(Agents, {} as Agents['Service']),
			Effect.provideService(Worktrees, {
				create: () =>
					Effect.promise(() => {
						entered.resolve();
						return release.promise;
					}),
			} as unknown as Worktrees['Service']),
		),
	);
	const session = insertSession(database, {
		uuid: 'session-cancel-window',
		title: 'Cancel window',
		cwd: '/repo',
	});
	const starting = Effect.runPromise(
		jobs.start({
			session,
			prompt: 'first',
			model: 'opencode:test',
			worktree: true,
		}),
	);
	await entered.promise;
	const reserved = database.db.select().from(schema.jobs).get();
	if (reserved === undefined) throw new Error('Expected reserved job');
	await Effect.runPromise(jobs.cancel({ jobId: reserved.uuid }));
	release.resolve('/repo-worktree');
	await starting;
	expect(runs).toBe(0);
	expect(database.db.select().from(schema.jobs).get()?.status).toBe(
		'cancelled',
	);
	database.sqlite.close();
});

test('interrupted worktree creation releases the running reservation', async () => {
	const database = createDatabase();
	const entered = Promise.withResolvers<void>();
	const harness = { backend: 'opencode' as const } as unknown as Harness;
	const jobs = await Effect.runPromise(
		Jobs.make.pipe(
			Effect.provideService(Db, {
				db: database.db,
				sqlite: database.sqlite,
			} as unknown as Db['Service']),
			Effect.provideService(HarnessRegistry, createHarnessRegistry(harness)),
			Effect.provideService(Settings, {
				getSetting: () => undefined,
			} as unknown as Settings['Service']),
			Effect.provideService(Agents, {} as Agents['Service']),
			Effect.provideService(Worktrees, {
				create: () =>
					Effect.sync(() => entered.resolve()).pipe(
						Effect.andThen(Effect.never),
					),
			} as unknown as Worktrees['Service']),
		),
	);
	const session = insertSession(database, {
		uuid: 'session-interrupted',
		title: 'Interrupted session',
		cwd: '/repo',
	});
	const starting = Effect.runFork(
		jobs.start({
			session,
			prompt: 'first',
			model: 'opencode:test',
			worktree: true,
		}),
	);
	await entered.promise;
	await Effect.runPromise(Fiber.interrupt(starting));
	expect(database.db.select().from(schema.jobs).get()?.status).toBe('error');
	database.sqlite.close();
});

test('keeps the session busy until its completion checkpoint is saved', async () => {
	const database = createDatabase();
	const capturing = Promise.withResolvers<void>();
	const release = Promise.withResolvers<string>();
	const harness = {
		backend: 'opencode' as const,
		runTurn: (input: { onSessionId?: (sessionId: string) => void }) =>
			Effect.sync(() => {
				input.onSessionId?.('ses_checkpoint');
				return {
					sessionId: 'ses_checkpoint',
					text: 'done',
					stopReason: 'end_turn',
				};
			}),
		getLatestMessageId: () =>
			Effect.promise(() => {
				capturing.resolve();
				return release.promise;
			}),
	} as unknown as Harness;
	const jobs = await Effect.runPromise(
		Jobs.make.pipe(
			Effect.provideService(Db, {
				db: database.db,
				sqlite: database.sqlite,
			} as unknown as Db['Service']),
			Effect.provideService(HarnessRegistry, createHarnessRegistry(harness)),
			Effect.provideService(Settings, {
				getSetting: () => undefined,
			} as unknown as Settings['Service']),
			Effect.provideService(Agents, {} as Agents['Service']),
			Effect.provideService(Worktrees, {} as Worktrees['Service']),
		),
	);
	const session = insertSession(database, {
		uuid: 'session-checkpoint',
		title: 'Checkpoint session',
		cwd: '/repo',
	});
	const started = await Effect.runPromise(
		jobs.start({ session, prompt: 'first', model: 'opencode:test' }),
	);
	await capturing.promise;
	expect(database.db.select().from(schema.jobs).get()?.status).toBe('running');
	await expect(
		Effect.runPromise(
			jobs.start({ session, prompt: 'second', model: 'opencode:test' }),
		),
	).rejects.toMatchObject({ code: 'SESSION_TURN_IN_PROGRESS' });
	release.resolve('msg_last');
	await Effect.runPromise(jobs.wait({ jobId: started.jobId, timeoutMs: 1000 }));
	expect(database.db.select().from(schema.jobs).get()).toMatchObject({
		status: 'done',
		harness_last_message_id: 'msg_last',
	});
	expect(jobs.getRootJobMetadata(started.jobId)).toMatchObject({
		title: 'Checkpoint session',
		sessionId: session.uuid,
		harnessSessionId: 'ses_checkpoint',
	});
	database.sqlite.close();
});
