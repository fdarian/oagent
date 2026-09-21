import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Effect, Fiber } from 'effect';
import { Agents } from './agents.ts';
import { Db } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import * as schema from './db/schema.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { JobStartError, Jobs } from './jobs.ts';
import type { OpenCode } from './opencode.ts';
import { Settings } from './settings.ts';
import { SIDE_CHAT_FIRST_PROMPT_REMINDER, SideChats } from './side-chats.ts';

const TEST_SCHEMA = `
	CREATE TABLE jobs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		uuid TEXT NOT NULL,
		status TEXT NOT NULL,
		prompt TEXT NOT NULL,
		cwd TEXT NOT NULL,
		model TEXT,
		agent_type TEXT,
		backend TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		terminated_at INTEGER,
		session_id TEXT,
		mcp_session_id TEXT,
		text TEXT,
		stop_reason TEXT,
		error_message TEXT,
		side_chat_id INTEGER
	);
	CREATE UNIQUE INDEX jobs_side_chat_running_uq
		ON jobs (side_chat_id)
		WHERE status = 'running';
	CREATE TABLE side_chats (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		uuid TEXT NOT NULL,
		source_job_id INTEGER NOT NULL,
		session_id TEXT,
		first_turn_dispatched_at INTEGER,
		created_at INTEGER NOT NULL
	);
`;

function createTestDatabase() {
	const sqlite = new Database(':memory:');
	sqlite.exec(TEST_SCHEMA);
	return { sqlite, db: drizzle(sqlite, { schema }) };
}

function createSharedTestDatabases() {
	const directory = mkdtempSync(join(tmpdir(), 'oagent-side-chats-'));
	const databasePath = join(directory, 'sqlite.db');
	const firstSqlite = new Database(databasePath);
	firstSqlite.exec(TEST_SCHEMA);
	firstSqlite.exec('PRAGMA journal_mode = WAL;');
	firstSqlite.exec('PRAGMA busy_timeout = 5000;');
	const secondSqlite = new Database(databasePath);
	secondSqlite.exec('PRAGMA busy_timeout = 5000;');
	return {
		first: { sqlite: firstSqlite, db: drizzle(firstSqlite, { schema }) },
		second: { sqlite: secondSqlite, db: drizzle(secondSqlite, { schema }) },
		close: () => {
			secondSqlite.close();
			firstSqlite.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

function createHarnessRegistry(
	opencode: OpenCode['Service'],
): HarnessRegistry['Service'] {
	return {
		all: [opencode],
		get: (backend) => {
			if (backend === 'opencode') return opencode;
			throw new Error(`Unexpected test harness: ${backend}`);
		},
		listAgentTargets: (backend) => {
			if (backend === 'opencode') return opencode.listAgentTargets();
			throw new Error(`Unexpected test harness: ${backend}`);
		},
	};
}

async function createSideChatServices(
	database: ReturnType<typeof createTestDatabase>,
	opencode: OpenCode['Service'],
) {
	const dbService = {
		db: database.db,
		sqlite: database.sqlite,
	} as unknown as Db['Service'];
	const jobs = await Effect.runPromise(
		Jobs.make.pipe(
			Effect.provideService(Db, dbService),
			Effect.provideService(HarnessRegistry, createHarnessRegistry(opencode)),
			Effect.provideService(Settings, {} as Settings['Service']),
			Effect.provideService(Agents, {} as Agents['Service']),
		),
	);
	const sideChats = await Effect.runPromise(
		SideChats.make.pipe(
			Effect.provideService(Db, dbService),
			Effect.provideService(Jobs, jobs),
			Effect.provideService(HarnessRegistry, createHarnessRegistry(opencode)),
		),
	);
	return { jobs, sideChats };
}

function createOpenCodeService(input: {
	forkSession: () => Effect.Effect<{ sessionId: string }, unknown, never>;
}): OpenCode['Service'] {
	return {
		forkSession: input.forkSession,
		runTurn: (turn: { sessionId?: string; onPromptDispatch?: () => void }) =>
			Effect.sync(() => {
				if (turn.sessionId === undefined) {
					throw new Error('Expected a side-chat session');
				}
				const onPromptDispatch = turn.onPromptDispatch;
				if (onPromptDispatch !== undefined) onPromptDispatch();
				return { sessionId: turn.sessionId, text: '', stopReason: undefined };
			}),
	} as unknown as OpenCode['Service'];
}

function createMigratedDatabase() {
	const sqlite = new Database(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON;');
	const db = drizzle(sqlite, { schema });
	Effect.runSync(runMigrations(db));
	return { sqlite, db };
}

describe('side chats', () => {
	test('keeps the reminder through pre-dispatch failures and reuses the forked session', async () => {
		const database = createTestDatabase();
		const startedInputs: Array<{
			agentPrompt?: string;
			sessionId?: string;
			cwd: string;
			model?: string;
			onPromptDispatch?: () => void;
		}> = [];
		const reservedInputs: Array<{
			prompt: string;
			sessionId?: string;
			sideChatId?: number;
			cwd: string;
			model?: string;
		}> = [];
		let forkCount = 0;
		let turnCount = 0;
		const jobs = {
			reserve: (input: {
				prompt: string;
				sessionId?: string;
				sideChatId?: number;
				cwd: string;
				model?: string;
			}) =>
				Effect.sync(() => {
					turnCount += 1;
					reservedInputs.push(input);
					const jobId = `turn-${turnCount}`;
					const job = database.db
						.insert(schema.jobs)
						.values({
							uuid: jobId,
							status: 'running',
							prompt: input.prompt,
							cwd: input.cwd,
							model: 'model',
							backend: 'opencode',
							session_id: input.sessionId,
							side_chat_id: input.sideChatId,
						})
						.returning({ id: schema.jobs.id })
						.get();
					if (job === undefined) throw new Error('Expected reserved job');
					return {
						internalId: job.id,
						jobId,
						prompt: input.prompt,
						cwd: input.cwd,
						backend: 'opencode',
						model: 'provider/model',
						reasoningEffort: undefined,
						sessionId: input.sessionId,
					};
				}),
			runReserved: (input: {
				reservation: {
					jobId: string;
					cwd: string;
					model: string;
				};
				agentPrompt?: string;
				sessionId?: string;
				onPromptDispatch?: () => void;
			}) =>
				Effect.sync(() => {
					startedInputs.push({
						agentPrompt: input.agentPrompt,
						sessionId: input.sessionId,
						cwd: input.reservation.cwd,
						model: input.reservation.model,
						onPromptDispatch: input.onPromptDispatch,
					});
					return { jobId: input.reservation.jobId };
				}),
			readEventsPage: () => ({ events: [], nextCursor: null }),
		} as unknown as Jobs['Service'];
		const opencode = {
			forkSession: () =>
				Effect.sync(() => {
					forkCount += 1;
					return { sessionId: 'ses_forked' };
				}),
		} as unknown as OpenCode['Service'];
		const dbService = {
			db: database.db,
			sqlite: database.sqlite,
		} as unknown as Db['Service'];
		const sideChats = await Effect.runPromise(
			SideChats.make.pipe(
				Effect.provideService(Db, dbService),
				Effect.provideService(Jobs, jobs),
				Effect.provideService(HarnessRegistry, createHarnessRegistry(opencode)),
			),
		);

		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'source-job',
				status: 'done',
				prompt: 'Source prompt',
				cwd: '/workspace',
				model: 'provider/model',
				backend: 'opencode',
				session_id: 'ses_source',
			})
			.run();

		const sideChat = await Effect.runPromise(sideChats.create('source-job'));
		expect(sideChat.turns).toEqual([]);
		expect(forkCount).toBe(0);

		await Effect.runPromise(
			sideChats.send({ sideChatId: sideChat.id, prompt: 'First raw message' }),
		);
		expect(forkCount).toBe(1);
		expect(reservedInputs[0]).toEqual({
			prompt: 'First raw message',
			sessionId: undefined,
			sideChatId: expect.any(Number),
			cwd: '/workspace',
			model: 'opencode:provider/model',
		});
		expect(startedInputs[0]).toEqual({
			agentPrompt: `First raw message\n\n${SIDE_CHAT_FIRST_PROMPT_REMINDER}`,
			sessionId: 'ses_forked',
			cwd: '/workspace',
			model: 'provider/model',
			onPromptDispatch: expect.any(Function),
		});

		database.db
			.update(schema.jobs)
			.set({ status: 'error', terminated_at: new Date() })
			.where(eq(schema.jobs.uuid, 'turn-1'))
			.run();
		const sideChatAfterPreDispatchFailure = database.db
			.select()
			.from(schema.sideChats)
			.where(eq(schema.sideChats.uuid, sideChat.id))
			.get();
		expect(
			sideChatAfterPreDispatchFailure?.first_turn_dispatched_at,
		).toBeNull();

		await Effect.runPromise(
			sideChats.send({ sideChatId: sideChat.id, prompt: 'Second raw message' }),
		);
		expect(forkCount).toBe(1);
		expect(startedInputs[1]).toEqual({
			agentPrompt: `Second raw message\n\n${SIDE_CHAT_FIRST_PROMPT_REMINDER}`,
			sessionId: 'ses_forked',
			cwd: '/workspace',
			model: 'provider/model',
			onPromptDispatch: expect.any(Function),
		});
		const secondStarted = startedInputs[1];
		if (
			secondStarted === undefined ||
			secondStarted.onPromptDispatch === undefined
		) {
			throw new Error('Expected the second side-chat turn to mark dispatch');
		}
		secondStarted.onPromptDispatch();

		const dispatchedSideChat = database.db
			.select()
			.from(schema.sideChats)
			.where(eq(schema.sideChats.uuid, sideChat.id))
			.get();
		expect(dispatchedSideChat?.first_turn_dispatched_at).toBeInstanceOf(Date);

		database.db
			.update(schema.jobs)
			.set({ status: 'done', terminated_at: new Date() })
			.where(eq(schema.jobs.uuid, 'turn-2'))
			.run();

		await Effect.runPromise(
			sideChats.send({ sideChatId: sideChat.id, prompt: 'Third raw message' }),
		);
		expect(startedInputs[2]).toEqual({
			agentPrompt: 'Third raw message',
			sessionId: 'ses_forked',
			cwd: '/workspace',
			model: 'provider/model',
			onPromptDispatch: undefined,
		});

		const storedTurn = database.db
			.select()
			.from(schema.jobs)
			.where(eq(schema.jobs.uuid, 'turn-1'))
			.get();
		expect(storedTurn?.prompt).toBe('First raw message');
		database.sqlite.close();
	});

	test('uses the database claim before forking from separate services', async () => {
		const databases = createSharedTestDatabases();
		const forkStarted = Promise.withResolvers<void>();
		const releaseFork = Promise.withResolvers<void>();
		let forkCount = 0;
		const firstOpenCode = createOpenCodeService({
			forkSession: () =>
				Effect.promise(async () => {
					forkCount += 1;
					forkStarted.resolve();
					await releaseFork.promise;
					return { sessionId: 'ses_first_fork' };
				}),
		});
		const secondOpenCode = createOpenCodeService({
			forkSession: () =>
				Effect.sync(() => {
					forkCount += 1;
					return { sessionId: 'ses_second_fork' };
				}),
		});
		const first = await createSideChatServices(databases.first, firstOpenCode);
		const second = await createSideChatServices(
			databases.second,
			secondOpenCode,
		);

		databases.first.db
			.insert(schema.jobs)
			.values({
				uuid: 'source-job',
				status: 'done',
				prompt: 'Source prompt',
				cwd: '/workspace',
				model: 'provider/model',
				backend: 'opencode',
				session_id: 'ses_source',
			})
			.run();
		const sideChat = await Effect.runPromise(
			first.sideChats.create('source-job'),
		);

		const firstSend = Effect.runPromise(
			first.sideChats.send({
				sideChatId: sideChat.id,
				prompt: 'First message',
			}),
		);
		await forkStarted.promise;
		await expect(
			Effect.runPromise(
				second.sideChats.send({
					sideChatId: sideChat.id,
					prompt: 'Concurrent message',
				}),
			),
		).rejects.toMatchObject({ code: 'TURN_IN_PROGRESS' });
		expect(forkCount).toBe(1);

		releaseFork.resolve();
		const firstTurn = await firstSend;
		expect(
			await Effect.runPromise(
				first.jobs.wait({ jobId: firstTurn.jobId, timeoutMs: 1_000 }),
			),
		).toMatchObject({ status: 'done' });
		expect(
			databases.first.db
				.select({ sessionId: schema.sideChats.session_id })
				.from(schema.sideChats)
				.where(eq(schema.sideChats.uuid, sideChat.id))
				.get(),
		).toEqual({ sessionId: 'ses_first_fork' });
		databases.close();
	});

	test('marks a reserved turn terminal when forking fails', async () => {
		const database = createTestDatabase();
		const opencode = createOpenCodeService({
			forkSession: () => Effect.fail(new Error('fork failed')),
		});
		const services = await createSideChatServices(database, opencode);
		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'source-job',
				status: 'done',
				prompt: 'Source prompt',
				cwd: '/workspace',
				model: 'provider/model',
				backend: 'opencode',
				session_id: 'ses_source',
			})
			.run();
		const sideChat = await Effect.runPromise(
			services.sideChats.create('source-job'),
		);

		await expect(
			Effect.runPromise(
				services.sideChats.send({
					sideChatId: sideChat.id,
					prompt: 'First message',
				}),
			),
		).rejects.toMatchObject({ code: 'FORK_FAILED' });
		const storedSideChat = database.db
			.select({ id: schema.sideChats.id })
			.from(schema.sideChats)
			.where(eq(schema.sideChats.uuid, sideChat.id))
			.get();
		if (storedSideChat === undefined) throw new Error('Expected side chat');
		expect(
			database.db
				.select({
					status: schema.jobs.status,
					terminatedAt: schema.jobs.terminated_at,
				})
				.from(schema.jobs)
				.where(eq(schema.jobs.side_chat_id, storedSideChat.id))
				.get(),
		).toEqual({ status: 'error', terminatedAt: expect.any(Date) });
		database.sqlite.close();
	});

	test('releases a reservation when send is interrupted before worker handoff', async () => {
		const database = createTestDatabase();
		const forkStarted = Promise.withResolvers<void>();
		const releaseFork = Promise.withResolvers<void>();
		let forkCount = 0;
		const opencode = createOpenCodeService({
			forkSession: () => {
				forkCount += 1;
				if (forkCount === 1) {
					return Effect.promise(async () => {
						forkStarted.resolve();
						await releaseFork.promise;
						return { sessionId: 'ses_interrupted_fork' };
					});
				}
				return Effect.succeed({ sessionId: 'ses_retry_fork' });
			},
		});
		const services = await createSideChatServices(database, opencode);
		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'source-job',
				status: 'done',
				prompt: 'Source prompt',
				cwd: '/workspace',
				model: 'provider/model',
				backend: 'opencode',
				session_id: 'ses_source',
			})
			.run();
		const sideChat = await Effect.runPromise(
			services.sideChats.create('source-job'),
		);

		const sendFiber = Effect.runFork(
			services.sideChats.send({
				sideChatId: sideChat.id,
				prompt: 'Interrupted message',
			}),
		);
		await forkStarted.promise;
		await Effect.runPromise(Fiber.interrupt(sendFiber));

		const storedSideChat = database.db
			.select({ id: schema.sideChats.id })
			.from(schema.sideChats)
			.where(eq(schema.sideChats.uuid, sideChat.id))
			.get();
		if (storedSideChat === undefined) throw new Error('Expected side chat');
		expect(
			database.db
				.select({
					status: schema.jobs.status,
					terminatedAt: schema.jobs.terminated_at,
				})
				.from(schema.jobs)
				.where(eq(schema.jobs.side_chat_id, storedSideChat.id))
				.get(),
		).toEqual({ status: 'error', terminatedAt: expect.any(Date) });

		releaseFork.resolve();
		const retry = await Effect.runPromise(
			services.sideChats.send({
				sideChatId: sideChat.id,
				prompt: 'Retry message',
			}),
		);
		expect(forkCount).toBe(2);
		expect(
			await Effect.runPromise(
				services.jobs.wait({ jobId: retry.jobId, timeoutMs: 1_000 }),
			),
		).toMatchObject({ status: 'done' });
		database.sqlite.close();
	});

	test('keeps a handed-off detached turn running when its caller is interrupted', async () => {
		const database = createTestDatabase();
		const turnStarted = Promise.withResolvers<void>();
		const releaseTurn = Promise.withResolvers<void>();
		const opencode = {
			forkSession: () => Effect.succeed({ sessionId: 'ses_side_chat' }),
			runTurn: () =>
				Effect.promise(async () => {
					turnStarted.resolve();
					await releaseTurn.promise;
					return {
						sessionId: 'ses_side_chat',
						text: 'Completed after caller interruption',
						stopReason: undefined,
					};
				}),
		} as unknown as OpenCode['Service'];
		const services = await createSideChatServices(database, opencode);
		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'source-job',
				status: 'done',
				prompt: 'Source prompt',
				cwd: '/workspace',
				model: 'provider/model',
				backend: 'opencode',
				session_id: 'ses_source',
			})
			.run();
		const sideChat = await Effect.runPromise(
			services.sideChats.create('source-job'),
		);
		const storedSideChat = database.db
			.select({ id: schema.sideChats.id })
			.from(schema.sideChats)
			.where(eq(schema.sideChats.uuid, sideChat.id))
			.get();
		if (storedSideChat === undefined) throw new Error('Expected side chat');
		const reservation = await Effect.runPromise(
			services.jobs.reserve({
				prompt: 'Detached message',
				model: 'opencode:provider/model',
				sessionId: 'ses_side_chat',
				sideChatId: storedSideChat.id,
				cwd: '/workspace',
			}),
		);

		const caller = Effect.runFork(
			services.jobs
				.runReserved({ reservation })
				.pipe(Effect.flatMap(() => Effect.never)),
		);
		await turnStarted.promise;
		await Effect.runPromise(Fiber.interrupt(caller));
		releaseTurn.resolve();
		expect(
			await Effect.runPromise(
				services.jobs.wait({ jobId: reservation.jobId, timeoutMs: 1_000 }),
			),
		).toMatchObject({
			status: 'done',
			text: 'Completed after caller interruption',
		});
		database.sqlite.close();
	});

	test('cascades child turns when migrated side chats or source jobs are deleted', () => {
		const database = createMigratedDatabase();
		const sourceJob = database.db
			.insert(schema.jobs)
			.values({
				uuid: 'source-job',
				status: 'done',
				prompt: 'Source prompt',
				cwd: '/workspace',
				backend: 'opencode',
			})
			.returning({ id: schema.jobs.id })
			.get();
		if (sourceJob === undefined) throw new Error('Expected source job');

		const firstSideChat = database.db
			.insert(schema.sideChats)
			.values({ uuid: 'side-chat-1', source_job_id: sourceJob.id })
			.returning({ id: schema.sideChats.id })
			.get();
		if (firstSideChat === undefined) throw new Error('Expected side chat');
		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'turn-1',
				status: 'done',
				prompt: 'First turn',
				cwd: '/workspace',
				backend: 'opencode',
				side_chat_id: firstSideChat.id,
			})
			.run();
		database.db
			.delete(schema.sideChats)
			.where(eq(schema.sideChats.id, firstSideChat.id))
			.run();
		expect(
			database.db
				.select({ id: schema.jobs.id })
				.from(schema.jobs)
				.where(eq(schema.jobs.uuid, 'turn-1'))
				.all(),
		).toEqual([]);

		const secondSideChat = database.db
			.insert(schema.sideChats)
			.values({ uuid: 'side-chat-2', source_job_id: sourceJob.id })
			.returning({ id: schema.sideChats.id })
			.get();
		if (secondSideChat === undefined) throw new Error('Expected side chat');
		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'turn-2',
				status: 'done',
				prompt: 'Second turn',
				cwd: '/workspace',
				backend: 'opencode',
				side_chat_id: secondSideChat.id,
			})
			.run();
		database.db
			.delete(schema.jobs)
			.where(eq(schema.jobs.id, sourceJob.id))
			.run();
		expect(
			database.db
				.select({ id: schema.sideChats.id })
				.from(schema.sideChats)
				.where(eq(schema.sideChats.id, secondSideChat.id))
				.all(),
		).toEqual([]);
		expect(
			database.db
				.select({ id: schema.jobs.id })
				.from(schema.jobs)
				.where(eq(schema.jobs.uuid, 'turn-2'))
				.all(),
		).toEqual([]);
		database.sqlite.close();
	});

	test('reads root metadata without replaying a large event history and hides side-chat turns', async () => {
		const database = createMigratedDatabase();
		const services = await createSideChatServices(
			database,
			createOpenCodeService({
				forkSession: () => Effect.succeed({ sessionId: 'ses_forked' }),
			}),
		);
		const sourceJob = database.db
			.insert(schema.jobs)
			.values({
				uuid: 'source-job',
				status: 'done',
				prompt: 'Source prompt',
				cwd: '/workspace',
				backend: 'opencode',
			})
			.returning({ id: schema.jobs.id })
			.get();
		if (sourceJob === undefined) throw new Error('Expected source job');

		database.db
			.insert(schema.events)
			.values(
				Array.from({ length: 500 }, () => ({
					job_id: sourceJob.id,
					type: 'agent_message_chunk' as const,
				})),
			)
			.run();

		const sideChat = database.db
			.insert(schema.sideChats)
			.values({ uuid: 'side-chat', source_job_id: sourceJob.id })
			.returning({ id: schema.sideChats.id })
			.get();
		if (sideChat === undefined) throw new Error('Expected side chat');
		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'side-chat-turn',
				status: 'done',
				prompt: 'Child prompt',
				cwd: '/workspace',
				backend: 'opencode',
				side_chat_id: sideChat.id,
			})
			.run();

		const rootMetadata = services.jobs.getRootJobMetadata('source-job');
		expect(rootMetadata).toMatchObject({
			id: 'source-job',
			prompt: 'Source prompt',
		});
		expect(rootMetadata).not.toHaveProperty('recentEvents');
		expect(services.jobs.getRootJobMetadata('side-chat-turn')).toBeUndefined();
		expect(services.jobs.getJobMetadata('side-chat-turn')).toMatchObject({
			id: 'side-chat-turn',
		});
		database.sqlite.close();
	});

	test('maps a persisted running-turn conflict to TURN_IN_PROGRESS', async () => {
		const database = createTestDatabase();
		const jobs = {
			reserve: () =>
				new JobStartError({
					code: 'SIDE_CHAT_TURN_IN_PROGRESS',
					message: 'This side chat already has a turn in progress.',
					cause: new Error('UNIQUE constraint failed: jobs.side_chat_id'),
				}),
			readEventsPage: () => ({ events: [], nextCursor: null }),
		} as unknown as Jobs['Service'];
		const opencode = {
			forkSession: () => Effect.succeed({ sessionId: 'ses_forked' }),
		} as unknown as OpenCode['Service'];
		const dbService = {
			db: database.db,
			sqlite: database.sqlite,
		} as unknown as Db['Service'];
		const sideChats = await Effect.runPromise(
			SideChats.make.pipe(
				Effect.provideService(Db, dbService),
				Effect.provideService(Jobs, jobs),
				Effect.provideService(HarnessRegistry, createHarnessRegistry(opencode)),
			),
		);

		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'source-job',
				status: 'done',
				prompt: 'Source prompt',
				cwd: '/workspace',
				model: 'provider/model',
				backend: 'opencode',
				session_id: 'ses_source',
			})
			.run();
		const sideChat = await Effect.runPromise(sideChats.create('source-job'));

		await expect(
			Effect.runPromise(
				sideChats.send({ sideChatId: sideChat.id, prompt: 'First message' }),
			),
		).rejects.toMatchObject({ code: 'TURN_IN_PROGRESS' });
		database.sqlite.close();
	});

	test('enforces one running turn per side chat in SQLite', () => {
		const database = createTestDatabase();
		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'source-job',
				status: 'done',
				prompt: 'Source prompt',
				cwd: '/workspace',
				model: 'provider/model',
				backend: 'opencode',
			})
			.run();
		const sourceJob = database.db
			.select()
			.from(schema.jobs)
			.where(eq(schema.jobs.uuid, 'source-job'))
			.get();
		if (sourceJob === undefined) throw new Error('Expected source job');
		database.db
			.insert(schema.sideChats)
			.values({ uuid: 'side-chat', source_job_id: sourceJob.id })
			.run();
		const sideChat = database.db
			.select()
			.from(schema.sideChats)
			.where(eq(schema.sideChats.uuid, 'side-chat'))
			.get();
		if (sideChat === undefined) throw new Error('Expected side chat');

		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'turn-1',
				status: 'running',
				prompt: 'First message',
				cwd: '/workspace',
				backend: 'opencode',
				side_chat_id: sideChat.id,
			})
			.run();
		expect(() =>
			database.db
				.insert(schema.jobs)
				.values({
					uuid: 'turn-2',
					status: 'running',
					prompt: 'Second message',
					cwd: '/workspace',
					backend: 'opencode',
					side_chat_id: sideChat.id,
				})
				.run(),
		).toThrow('UNIQUE constraint failed: jobs.side_chat_id');
		database.sqlite.close();
	});

	test('rejects a non-OpenCode source before creating a tab', async () => {
		const database = createTestDatabase();
		const jobs = {
			readEventsPage: () => ({ events: [], nextCursor: null }),
		} as unknown as Jobs['Service'];
		const opencode = {} as OpenCode['Service'];
		const dbService = {
			db: database.db,
			sqlite: database.sqlite,
		} as unknown as Db['Service'];
		const sideChats = await Effect.runPromise(
			SideChats.make.pipe(
				Effect.provideService(Db, dbService),
				Effect.provideService(Jobs, jobs),
				Effect.provideService(HarnessRegistry, createHarnessRegistry(opencode)),
			),
		);

		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'cursor-source',
				status: 'done',
				prompt: 'Source prompt',
				cwd: '/workspace',
				model: 'model',
				backend: 'cursor',
				session_id: 'session',
			})
			.run();

		await expect(
			Effect.runPromise(sideChats.create('cursor-source')),
		).rejects.toMatchObject({
			code: 'UNSUPPORTED_HARNESS',
		});
		database.sqlite.close();
	});
});
