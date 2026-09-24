import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { Agents } from './agents.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import type { Backend, Harness } from './harness.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { Jobs } from './jobs.ts';
import { Sessions } from './sessions.ts';
import { Settings } from './settings.ts';
import { createTestDatabase } from './test-database.ts';
import { Worktrees } from './worktree.ts';

type TestDatabase = ReturnType<typeof createTestDatabase>;
type TurnInput = Parameters<Harness['runTurn']>[0];
type TurnEffect = ReturnType<Harness['runTurn']>;

function createServices(
	database: TestDatabase,
	backend: Backend,
	runTurn: (input: TurnInput) => TurnEffect,
	options?: {
		steer?: Harness['steer'];
		forkSession?: Harness['forkSession'];
		forkSessionBefore?: Harness['forkSessionBefore'];
		getFirstMessageAfter?: Harness['getFirstMessageAfter'];
		getLatestMessageId?: Harness['getLatestMessageId'];
	},
) {
	const harness = {
		backend,
		runTurn,
		steer: options?.steer,
		forkSession: options?.forkSession,
		forkSessionBefore: options?.forkSessionBefore,
		getFirstMessageAfter: options?.getFirstMessageAfter,
		getLatestMessageId: options?.getLatestMessageId,
	} as unknown as Harness;
	const dbService = {
		db: database.db,
		sqlite: database.sqlite,
	} as unknown as Db['Service'];
	const registry = {
		all: [harness],
		get: () => harness,
		listAgentTargets: () => Effect.succeed([]),
	} as unknown as HarnessRegistry['Service'];
	const settings = {
		getSetting: () => undefined,
	} as unknown as Settings['Service'];
	const agents = {
		resolve: (name: string) => Effect.succeed(`${name}-target`),
	} as unknown as Agents['Service'];
	const worktrees = {
		create: () => Effect.succeed('/tmp/worktree'),
	} as unknown as Worktrees['Service'];

	return Effect.runPromise(
		Jobs.make.pipe(
			Effect.provideService(Db, dbService),
			Effect.provideService(HarnessRegistry, registry),
			Effect.provideService(Settings, settings),
			Effect.provideService(Agents, agents),
			Effect.provideService(Worktrees, worktrees),
		),
	).then((jobs) =>
		Effect.runPromise(
			Sessions.make.pipe(
				Effect.provideService(Db, dbService),
				Effect.provideService(HarnessRegistry, registry),
				Effect.provideService(Jobs, jobs),
			),
		).then((sessions) => ({ jobs, sessions, harness })),
	);
}

function insertSession(
	database: TestDatabase,
	input: {
		uuid: string;
		backend: Backend;
		harnessSessionId: string;
		cwd: string;
	},
) {
	const session = database.db
		.insert(schema.sessions)
		.values({
			uuid: input.uuid,
			backend: input.backend,
			harness_session_id: input.harnessSessionId,
			cwd: input.cwd,
		})
		.returning()
		.get();
	if (session === undefined) throw new Error('Expected inserted session');
	return session;
}

function insertJob(
	database: TestDatabase,
	session: typeof schema.sessions.$inferSelect,
	input: {
		uuid: string;
		status: 'done';
		prompt: string;
		model: string;
		agentType?: string;
		harnessLastMessageId?: string;
	},
) {
	const job = database.db
		.insert(schema.jobs)
		.values({
			uuid: input.uuid,
			status: input.status,
			prompt: input.prompt,
			model: input.model,
			agent_type: input.agentType,
			session_id: session.id,
			harness_last_message_id: input.harnessLastMessageId,
		})
		.returning()
		.get();
	if (job === undefined) throw new Error('Expected inserted job');
	return job;
}

describe('session turns', () => {
	test('persists a session before starting and continues idle turns with inherited settings', async () => {
		const database = createTestDatabase();
		const calls: Array<{
			prompt: string;
			model: string | undefined;
			mode: string | undefined;
			sessionId: string | undefined;
		}> = [];
		const turnStarted = Promise.withResolvers<void>();
		const releaseTurn = Promise.withResolvers<void>();
		const services = await createServices(database, 'opencode', (input) =>
			Effect.promise(async () => {
				calls.push({
					prompt: input.prompt,
					model: input.model,
					mode: input.mode,
					sessionId: input.sessionId,
				});
				turnStarted.resolve();
				await releaseTurn.promise;
				return {
					sessionId: input.sessionId ?? 'ses_started',
					text: `Final: ${input.prompt}`,
					stopReason: 'end_turn',
				};
			}),
		);

		const started = await Effect.runPromise(
			services.sessions.start({
				prompt: 'first prompt',
				cwd: '/repo',
				model: 'opencode:model-id',
				agentType: 'reviewer',
				mcpSessionId: 'mcp-1',
			}),
		);
		const stored = database.db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.uuid, started.sessionId))
			.get();
		expect(stored).toMatchObject({
			backend: 'opencode',
			cwd: '/repo',
			mcp_session_id: 'mcp-1',
		});
		await turnStarted.promise;
		releaseTurn.resolve();
		expect(
			await Effect.runPromise(
				services.jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
			),
		).toMatchObject({ status: 'done', text: 'Final: first prompt' });

		const continued = await Effect.runPromise(
			services.sessions.sendMessage({
				sessionId: started.sessionId,
				prompt: 'second prompt',
			}),
		);
		expect(continued).toMatchObject({
			sessionId: started.sessionId,
			delivery: 'started',
		});
		expect(
			await Effect.runPromise(
				services.jobs.wait({ jobId: continued.jobId, timeoutMs: 1_000 }),
			),
		).toMatchObject({ status: 'done', text: 'Final: second prompt' });
		expect(
			await Effect.runPromise(
				services.sessions.read({ sessionId: started.sessionId }),
			),
		).toMatchObject({
			status: 'done',
			jobId: continued.jobId,
			text: 'Final: second prompt',
		});
		expect(
			await Effect.runPromise(
				services.sessions.list({ mcpSessionId: 'mcp-1' }),
			),
		).toMatchObject([
			{
				id: started.sessionId,
				jobId: continued.jobId,
				status: 'done',
				prompt: 'second prompt',
			},
		]);
		expect(
			await Effect.runPromise(
				services.sessions.cancel({ sessionId: started.sessionId }),
			),
		).toEqual({ ok: true, status: 'idle' });
		expect(calls).toEqual([
			{
				prompt: 'first prompt',
				model: 'model-id',
				mode: 'reviewer-target',
				sessionId: undefined,
			},
			{
				prompt: 'second prompt',
				model: 'model-id',
				mode: 'reviewer-target',
				sessionId: 'ses_started',
			},
		]);
		database.sqlite.close();
	});

	test('steers a running OpenCode turn and rejects busy sessions on other backends', async () => {
		const database = createTestDatabase();
		const turnStarted = Promise.withResolvers<void>();
		const releaseTurn = Promise.withResolvers<void>();
		const steered: string[] = [];
		const services = await createServices(
			database,
			'opencode',
			(input) =>
				Effect.promise(async () => {
					input.onSessionId?.('ses_running');
					turnStarted.resolve();
					await releaseTurn.promise;
					return {
						sessionId: input.sessionId ?? 'ses_running',
						text: 'done',
						stopReason: 'end_turn',
					};
				}),
			{
				steer: (input) =>
					Effect.sync(() => {
						steered.push(input.text);
						return { messageId: 'msg-steered', text: input.text };
					}),
			},
		);
		const started = await Effect.runPromise(
			services.sessions.start({
				prompt: 'work',
				cwd: '/repo',
				model: 'opencode:model',
			}),
		);
		await turnStarted.promise;
		const storedSession = database.db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.uuid, started.sessionId))
			.get();
		if (storedSession === undefined)
			throw new Error('Expected running session');
		await expect(
			Effect.runPromise(
				services.jobs.start({
					session: storedSession,
					prompt: 'concurrent turn',
					model: 'opencode:model',
				}),
			),
		).rejects.toMatchObject({ code: 'SESSION_TURN_IN_PROGRESS' });
		const steeredResult = await Effect.runPromise(
			services.sessions.sendMessage({
				sessionId: started.sessionId,
				prompt: 'also check tests',
			}),
		);
		expect(steeredResult).toEqual({
			sessionId: started.sessionId,
			jobId: started.jobId,
			delivery: 'steered',
		});
		expect(steered).toEqual(['also check tests']);
		releaseTurn.resolve();
		await Effect.runPromise(
			services.jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
		);
		database.sqlite.close();

		const cursorDatabase = createTestDatabase();
		const cursorStarted = Promise.withResolvers<void>();
		const releaseCursor = Promise.withResolvers<void>();
		const cursor = await createServices(cursorDatabase, 'cursor', (input) =>
			Effect.promise(async () => {
				cursorStarted.resolve();
				await releaseCursor.promise;
				return {
					sessionId: input.sessionId ?? 'ses_cursor',
					text: 'done',
					stopReason: 'end_turn',
				};
			}),
		);
		const cursorSession = await Effect.runPromise(
			cursor.sessions.start({
				prompt: 'work',
				cwd: '/repo',
				model: 'cursor:model',
			}),
		);
		await cursorStarted.promise;
		await expect(
			Effect.runPromise(
				cursor.sessions.sendMessage({
					sessionId: cursorSession.sessionId,
					prompt: 'steer this',
				}),
			),
		).rejects.toMatchObject({
			_tag: 'SessionBusy',
			code: 'UNSUPPORTED_BACKEND',
		});
		releaseCursor.resolve();
		await Effect.runPromise(
			cursor.jobs.wait({ jobId: cursorSession.jobId, timeoutMs: 1_000 }),
		);
		cursorDatabase.sqlite.close();
	});

	test('starts a new turn when the running turn finishes during steering', async () => {
		const database = createTestDatabase();
		const firstStarted = Promise.withResolvers<void>();
		const finishFirst = Promise.withResolvers<void>();
		const steering = Promise.withResolvers<void>();
		const finishSteer = Promise.withResolvers<void>();
		const prompts: string[] = [];
		const services = await createServices(
			database,
			'opencode',
			(input) =>
				Effect.promise(async () => {
					prompts.push(input.prompt);
					input.onSessionId?.('ses_race');
					if (prompts.length === 1) {
						firstStarted.resolve();
						await finishFirst.promise;
					}
					return {
						sessionId: 'ses_race',
						text: 'done',
						stopReason: 'end_turn',
					};
				}),
			{
				steer: () =>
					Effect.promise(async () => {
						steering.resolve();
						await finishSteer.promise;
						return { messageId: 'msg_late', text: 'second' };
					}),
			},
		);
		const started = await Effect.runPromise(
			services.sessions.start({
				prompt: 'first',
				cwd: '/repo',
				model: 'opencode:model',
			}),
		);
		await firstStarted.promise;
		const followUp = Effect.runPromise(
			services.sessions.sendMessage({
				sessionId: started.sessionId,
				prompt: 'second',
			}),
		);
		await steering.promise;
		finishFirst.resolve();
		await Effect.runPromise(
			services.jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
		);
		finishSteer.resolve();
		const result = await followUp;
		expect(result.delivery).toBe('started');
		await Effect.runPromise(
			services.jobs.wait({ jobId: result.jobId, timeoutMs: 1_000 }),
		);
		expect(prompts).toEqual(['first', 'second']);
		database.sqlite.close();
	});

	test('reads the latest turn and cancels only a running turn', async () => {
		const database = createTestDatabase();
		const turnStarted = Promise.withResolvers<void>();
		const releaseTurn = Promise.withResolvers<void>();
		const services = await createServices(database, 'opencode', (input) =>
			Effect.promise(async () => {
				turnStarted.resolve();
				await releaseTurn.promise;
				return {
					sessionId: input.sessionId ?? 'ses_cancel',
					text: 'cancelled turn output',
					stopReason: 'end_turn',
				};
			}),
		);
		const started = await Effect.runPromise(
			services.sessions.start({
				prompt: 'long task',
				cwd: '/repo',
				model: 'opencode:model',
			}),
		);
		await turnStarted.promise;
		expect(
			await Effect.runPromise(
				services.sessions.read({
					sessionId: started.sessionId,
					timeoutMs: 1,
				}),
			),
		).toMatchObject({ status: 'running', jobId: started.jobId });
		expect(
			await Effect.runPromise(
				services.sessions.cancel({ sessionId: started.sessionId }),
			),
		).toEqual({ ok: true, status: 'cancelled' });
		expect(
			await Effect.runPromise(
				services.sessions.read({ sessionId: started.sessionId }),
			),
		).toMatchObject({ status: 'cancelled', jobId: started.jobId });
		expect(
			await Effect.runPromise(
				services.sessions.cancel({ sessionId: 'missing' }),
			),
		).toEqual({ ok: false });
		releaseTurn.resolve();
		database.sqlite.close();
	});

	test('forks a session through ACP and an earlier OpenCode job at its checkpoint', async () => {
		const database = createTestDatabase();
		const calls: Array<{
			sessionId: string | undefined;
			model: string | undefined;
		}> = [];
		const firstMessageLookups: string[] = [];
		const beforeForks: string[] = [];
		const services = await createServices(
			database,
			'opencode',
			(input) =>
				Effect.sync(() => {
					calls.push({ sessionId: input.sessionId, model: input.model });
					return {
						sessionId: input.sessionId ?? 'ses_new',
						text: 'fork turn',
						stopReason: 'end_turn',
					};
				}),
			{
				forkSession: () => Effect.succeed({ sessionId: 'ses_acp_fork' }),
				getFirstMessageAfter: (input) =>
					Effect.sync(() => {
						firstMessageLookups.push(input.messageId);
						return 'msg-after-first-turn';
					}),
				forkSessionBefore: (input) =>
					Effect.sync(() => {
						beforeForks.push(input.before);
						return { sessionId: 'ses_rest_fork' };
					}),
			},
		);
		const sourceSession = insertSession(database, {
			uuid: 'session-source',
			backend: 'opencode',
			harnessSessionId: 'ses_source',
			cwd: '/repo',
		});
		const earlierJob = insertJob(database, sourceSession, {
			uuid: 'job-earlier',
			status: 'done',
			prompt: 'first source turn',
			model: 'first-model',
			agentType: 'reviewer',
			harnessLastMessageId: 'msg-last-first-turn',
		});
		insertJob(database, sourceSession, {
			uuid: 'job-latest',
			status: 'done',
			prompt: 'second source turn',
			model: 'second-model',
		});

		const forkedBySession = await Effect.runPromise(
			services.sessions.start({
				prompt: 'continue full state',
				forkId: sourceSession.uuid,
			}),
		);
		await Effect.runPromise(
			services.jobs.wait({ jobId: forkedBySession.jobId, timeoutMs: 1_000 }),
		);
		const forkedSession = database.db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.uuid, forkedBySession.sessionId))
			.get();
		const forkedByEarlierJob = await Effect.runPromise(
			services.sessions.start({
				prompt: 'continue earlier state',
				forkId: earlierJob.uuid,
			}),
		);
		await Effect.runPromise(
			services.jobs.wait({ jobId: forkedByEarlierJob.jobId, timeoutMs: 1_000 }),
		);
		const earlierForkSession = database.db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.uuid, forkedByEarlierJob.sessionId))
			.get();

		expect(forkedSession?.forked_from_job_id).toBe(
			database.db
				.select({ id: schema.jobs.id })
				.from(schema.jobs)
				.where(eq(schema.jobs.uuid, 'job-latest'))
				.get()?.id,
		);
		expect(earlierForkSession?.forked_from_job_id).toBe(earlierJob.id);
		expect(firstMessageLookups).toEqual(['msg-last-first-turn']);
		expect(beforeForks).toEqual(['msg-after-first-turn']);
		expect(calls).toEqual([
			{ sessionId: 'ses_acp_fork', model: 'second-model' },
			{ sessionId: 'ses_rest_fork', model: 'first-model' },
		]);
		database.sqlite.close();
	});

	test('rejects earlier-job forks without an OpenCode checkpoint', async () => {
		const database = createTestDatabase();
		const services = await createServices(database, 'opencode', (input) =>
			Effect.sync(() => ({
				sessionId: input.sessionId ?? 'ses_new',
				text: 'unused',
				stopReason: 'end_turn',
			})),
		);
		const sourceSession = insertSession(database, {
			uuid: 'session-no-checkpoint',
			backend: 'opencode',
			harnessSessionId: 'ses_source',
			cwd: '/repo',
		});
		insertJob(database, sourceSession, {
			uuid: 'job-no-checkpoint',
			status: 'done',
			prompt: 'first',
			model: 'model',
		});
		insertJob(database, sourceSession, {
			uuid: 'job-newer',
			status: 'done',
			prompt: 'second',
			model: 'model',
		});

		await expect(
			Effect.runPromise(
				services.sessions.start({
					prompt: 'fork without checkpoint',
					forkId: 'job-no-checkpoint',
				}),
			),
		).rejects.toMatchObject({
			_tag: 'SessionForkError',
			code: 'MISSING_CHECKPOINT',
		});
		database.sqlite.close();
	});
});
