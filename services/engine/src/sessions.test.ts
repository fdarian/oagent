import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Effect, Scope } from 'effect';
import { Agents, AgentTypeNotFound } from './agents.ts';
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
		agentResolve?: Agents['Service']['resolve'];
	},
) {
	const harness = {
		backend,
		supportsModelSwitch: backend === 'opencode' || backend === 'cursor',
		listModels: () => Effect.succeed([{ id: 'model' }, { id: 'new-model' }]),
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
		resolve:
			options?.agentResolve ??
			((name: string) => Effect.succeed(`${name}-target`)),
	} as unknown as Agents['Service'];
	const worktrees = {
		create: () => Effect.succeed('/tmp/worktree'),
	} as unknown as Worktrees['Service'];

	return Effect.runPromise(
		Jobs.make.pipe(
			Effect.provideService(Scope.Scope, Effect.runSync(Scope.make())),
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
		title: string;
		backend: Backend;
		harnessSessionId: string;
		cwd: string;
	},
) {
	const session = database.db
		.insert(schema.sessions)
		.values({
			uuid: input.uuid,
			title: input.title,
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
	test('configured agent edits apply to continuations and targets stay null', async () => {
		const database = createTestDatabase();
		let target = 'first-target';
		const modes: Array<string | undefined> = [];
		const services = await createServices(
			database,
			'opencode',
			(input) =>
				Effect.sync(() => {
					modes.push(input.mode);
					input.onSessionId?.('configured-harness');
					return {
						sessionId: 'configured-harness',
						text: 'done',
						stopReason: 'end_turn',
					};
				}),
			{ agentResolve: () => Effect.succeed(target) },
		);
		const first = await Effect.runPromise(
			services.sessions.start({
				title: 'Configured',
				prompt: 'one',
				cwd: '/repo',
				model: 'opencode:model',
				agentType: 'configured',
			}),
		);
		await Effect.runPromise(services.jobs.wait({ jobId: first.jobId }));
		target = 'edited-target';
		const next = await Effect.runPromise(
			services.sessions.sendMessage({
				sessionId: first.sessionId,
				prompt: 'two',
			}),
		);
		await Effect.runPromise(services.jobs.wait({ jobId: next.jobId }));
		expect(modes).toEqual(['first-target', 'edited-target']);
		expect(
			database.db
				.select()
				.from(schema.jobs)
				.all()
				.map((job) => job.agent_target),
		).toEqual([null, null]);
		database.sqlite.close();
	});
	test('fork of an inline job with no model retains its target with an explicit model', async () => {
		const database = createTestDatabase();
		const modes: Array<string | undefined> = [];
		const services = await createServices(
			database,
			'opencode',
			(input) =>
				Effect.sync(() => {
					modes.push(input.mode);
					input.onSessionId?.('inline-harness');
					return {
						sessionId: 'inline-harness',
						text: 'done',
						stopReason: 'end_turn',
					};
				}),
			{
				forkSession: () => Effect.succeed({ sessionId: 'forked-harness' }),
				agentResolve: (name) =>
					new AgentTypeNotFound({ agentType: name, configuredAgentTypes: [] }),
			},
		);
		const first = await Effect.runPromise(
			services.sessions.start({
				title: 'Inline',
				prompt: 'one',
				cwd: '/repo',
				model: 'opencode:model',
				agent: {
					name: 'ephemeral',
					targets: [{ backend: 'opencode', target: 'snapshot' }],
				},
			}),
		);
		await Effect.runPromise(services.jobs.wait({ jobId: first.jobId }));
		database.db.update(schema.jobs).set({ model: null }).run();
		const fork = await Effect.runPromise(
			services.sessions.start({
				title: 'Fork',
				prompt: 'two',
				forkId: first.jobId,
				model: 'opencode:model',
			}),
		);
		await Effect.runPromise(services.jobs.wait({ jobId: fork.jobId }));
		expect(modes).toEqual(['snapshot', 'snapshot']);
		database.sqlite.close();
	});
	test('continues an inline agent without a DB definition', async () => {
		const database = createTestDatabase();
		const modes: Array<string | undefined> = [];
		const services = await createServices(
			database,
			'opencode',
			(input) =>
				Effect.sync(() => {
					modes.push(input.mode);
					input.onSessionId?.('inline-harness');
					return {
						sessionId: 'inline-harness',
						text: 'done',
						stopReason: 'end_turn',
					};
				}),
			{
				agentResolve: (name) =>
					new AgentTypeNotFound({ agentType: name, configuredAgentTypes: [] }),
			},
		);
		const started = await Effect.runPromise(
			services.sessions.start({
				title: 'Inline',
				prompt: 'first',
				cwd: '/repo',
				model: 'opencode:model',
				agent: {
					name: 'ephemeral',
					targets: [{ backend: 'opencode', target: 'reviewer' }],
				},
			}),
		);
		await Effect.runPromise(services.jobs.wait({ jobId: started.jobId }));
		const continued = await Effect.runPromise(
			services.sessions.sendMessage({
				sessionId: started.sessionId,
				prompt: 'second',
			}),
		);
		await Effect.runPromise(services.jobs.wait({ jobId: continued.jobId }));
		expect(modes).toEqual(['reviewer', 'reviewer']);
		expect(
			database.db
				.select()
				.from(schema.jobs)
				.all()
				.map((job) => job.agent_target),
		).toEqual(['reviewer', 'reviewer']);
		database.sqlite.close();
	});
	for (const backend of ['opencode', 'cursor'] as const) {
		test(`persists a ${backend} model override during a running turn for future turns`, async () => {
			const database = createTestDatabase();
			const calls: Array<{ model?: string; effort?: string }> = [];
			const turnStarted = Promise.withResolvers<void>();
			const releaseTurn = Promise.withResolvers<void>();
			const services = await createServices(database, backend, (input) =>
				Effect.promise(async () => {
					calls.push({ model: input.model, effort: input.reasoningEffort });
					input.onSessionId?.('harness');
					turnStarted.resolve();
					await releaseTurn.promise;
					return { sessionId: 'harness', text: 'done', stopReason: 'end_turn' };
				}),
			);
			database.db
				.insert(schema.modelAliases)
				.values({
					name: 'deep',
					backend,
					model_id: 'model',
					reasoning_effort: 'high',
				})
				.run();
			const started = await Effect.runPromise(
				services.sessions.start({
					title: 'Switch',
					prompt: 'first',
					cwd: '/repo',
					model: 'deep',
				}),
			);
			await turnStarted.promise;
			expect(
				await Effect.runPromise(
					services.sessions.get({ sessionId: started.sessionId }),
				),
			).toMatchObject({
				model: 'model',
				supportsModelSwitch: true,
			});
			database.db
				.update(schema.sessions)
				.set({ reasoning_effort: 'high' })
				.run();
			await Effect.runPromise(
				services.sessions.setModel(started.sessionId, 'new-model'),
			);
			expect(database.db.select().from(schema.sessions).get()).toMatchObject({
				model: 'new-model',
				reasoning_effort: null,
			});
			const detail = await Effect.runPromise(
				services.sessions.get({ sessionId: started.sessionId }),
			);
			expect(detail.model).toBe('new-model');
			expect(detail.jobs[0]?.model).toBe('model');
			expect(calls).toEqual([{ model: 'model', effort: 'high' }]);
			releaseTurn.resolve();
			await Effect.runPromise(services.jobs.wait({ jobId: started.jobId }));
			for (const prompt of ['second', 'third']) {
				const turn = await Effect.runPromise(
					services.sessions.sendMessage({
						sessionId: started.sessionId,
						prompt,
					}),
				);
				await Effect.runPromise(services.jobs.wait({ jobId: turn.jobId }));
			}
			expect(calls).toEqual([
				{ model: 'model', effort: 'high' },
				{ model: 'new-model', effort: undefined },
				{ model: 'new-model', effort: undefined },
			]);
			await expect(
				Effect.runPromise(
					services.sessions.setModel(started.sessionId, 'unknown'),
				),
			).rejects.toMatchObject({
				_tag: 'SessionModelError',
				code: 'INVALID_MODEL',
			});
			expect(database.db.select().from(schema.sessions).get()?.model).toBe(
				'new-model',
			);
			database.sqlite.close();
		});
	}
	for (const backend of ['claude', 'codex', 'grok', 'pi'] as const) {
		test(`rejects model switching on ${backend}`, async () => {
			const database = createTestDatabase();
			const services = await createServices(database, backend, () =>
				Effect.succeed({
					sessionId: 'harness',
					text: 'done',
					stopReason: 'end_turn',
				}),
			);
			const session = insertSession(database, {
				uuid: 'unsupported',
				title: 'Unsupported',
				backend,
				harnessSessionId: 'harness',
				cwd: '/repo',
			});
			await expect(
				Effect.runPromise(
					services.sessions.setModel(session.uuid, 'new-model'),
				),
			).rejects.toMatchObject({
				_tag: 'SessionModelError',
				code: 'UNSUPPORTED_BACKEND',
			});
			expect(
				await Effect.runPromise(
					services.sessions.get({ sessionId: session.uuid }),
				),
			).toMatchObject({ supportsModelSwitch: false });
			expect(
				database.db.select().from(schema.sessions).get()?.model,
			).toBeNull();
			await expect(
				Effect.runPromise(services.sessions.setModel('missing', 'new-model')),
			).rejects.toMatchObject({ _tag: 'SessionNotFound' });
			database.sqlite.close();
		});
	}
	test('lists session details and root turns in chronological order without side-chat turns', async () => {
		const database = createTestDatabase();
		const services = await createServices(database, 'opencode', () =>
			Effect.succeed({
				sessionId: 'harness',
				text: 'done',
				stopReason: 'end_turn',
			}),
		);
		const session = insertSession(database, {
			uuid: 'session-history',
			title: 'History',
			backend: 'opencode',
			harnessSessionId: 'harness',
			cwd: '/repo',
		});
		insertJob(database, session, {
			uuid: 'first',
			status: 'done',
			prompt: 'first prompt',
			model: 'provider/model',
		});
		insertJob(database, session, {
			uuid: 'second',
			status: 'done',
			prompt: 'follow-up',
			model: 'provider/model',
		});
		const sideChat = database.db
			.insert(schema.sideChats)
			.values({
				uuid: 'side-chat-history',
				source_job_id: 1,
				session_id: session.uuid,
			})
			.returning()
			.get();
		if (sideChat === undefined) throw new Error('Expected side chat');
		database.db
			.insert(schema.jobs)
			.values({
				uuid: 'side-turn',
				session_id: session.id,
				side_chat_id: sideChat.id,
				status: 'done',
				prompt: 'side prompt',
			})
			.run();
		const detail = await Effect.runPromise(
			services.sessions.get({ sessionId: session.uuid }),
		);
		expect(detail).toMatchObject({
			id: session.uuid,
			title: 'History',
			cwd: '/repo',
			status: 'done',
		});
		expect(
			detail.jobs.map((job) => ({
				id: job.id,
				prompt: job.prompt,
				sessionId: job.sessionId,
			})),
		).toEqual([
			{ id: 'first', prompt: 'first prompt', sessionId: session.uuid },
			{ id: 'second', prompt: 'follow-up', sessionId: session.uuid },
		]);
		expect(
			(await Effect.runPromise(services.sessions.list({})))[0],
		).toMatchObject({
			id: session.uuid,
			cwd: '/repo',
			model: 'provider/model',
		});
		database.sqlite.close();
	});
	test('keeps alias reasoning effort across follow-up turns and forks', async () => {
		const database = createTestDatabase();
		database.db
			.insert(schema.modelAliases)
			.values({
				name: 'deep',
				backend: 'opencode',
				model_id: 'provider/model',
				reasoning_effort: 'high',
			})
			.run();
		const calls: Array<string | undefined> = [];
		const services = await createServices(
			database,
			'opencode',
			(input) =>
				Effect.sync(() => {
					calls.push(input.reasoningEffort);
					input.onSessionId?.(input.sessionId ?? 'ses_alias');
					return {
						sessionId: input.sessionId ?? 'ses_alias',
						text: 'done',
						stopReason: 'end_turn',
					};
				}),
			{
				forkSession: () => Effect.succeed({ sessionId: 'ses_alias_fork' }),
			},
		);
		const started = await Effect.runPromise(
			services.sessions.start({
				title: 'First session',
				prompt: 'first',
				cwd: '/repo',
				model: 'deep',
			}),
		);
		await Effect.runPromise(
			services.jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
		);
		const continued = await Effect.runPromise(
			services.sessions.sendMessage({
				sessionId: started.sessionId,
				prompt: 'second',
			}),
		);
		await Effect.runPromise(
			services.jobs.wait({ jobId: continued.jobId, timeoutMs: 1_000 }),
		);
		const forked = await Effect.runPromise(
			services.sessions.start({
				title: 'Forked session',
				prompt: 'fork',
				forkId: started.sessionId,
			}),
		);
		await Effect.runPromise(
			services.jobs.wait({ jobId: forked.jobId, timeoutMs: 1_000 }),
		);
		expect(calls).toEqual(['high', 'high', 'high']);
		expect(
			database.db
				.select({ effort: schema.jobs.reasoning_effort })
				.from(schema.jobs)
				.all(),
		).toEqual([{ effort: 'high' }, { effort: 'high' }, { effort: 'high' }]);
		database.sqlite.close();
	});

	test('rejects an incompatible fork model before creating a harness fork or session row', async () => {
		const database = createTestDatabase();
		let forks = 0;
		const services = await createServices(
			database,
			'opencode',
			(input) =>
				Effect.sync(() => {
					input.onSessionId?.('ses_original');
					return {
						sessionId: 'ses_original',
						text: 'done',
						stopReason: 'end_turn',
					};
				}),
			{
				forkSession: () =>
					Effect.sync(() => {
						forks += 1;
						return { sessionId: 'ses_unwanted' };
					}),
			},
		);
		const started = await Effect.runPromise(
			services.sessions.start({
				title: 'Original session',
				prompt: 'first',
				cwd: '/repo',
				model: 'opencode:model',
			}),
		);
		await Effect.runPromise(
			services.jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
		);
		await expect(
			Effect.runPromise(
				services.sessions.start({
					title: 'Fork attempt',
					prompt: 'fork',
					forkId: started.sessionId,
					model: 'codex:model',
				}),
			),
		).rejects.toMatchObject({ code: 'SESSION_BACKEND_MISMATCH' });
		expect(forks).toBe(0);
		expect(database.db.select().from(schema.sessions).all()).toHaveLength(1);
		database.sqlite.close();
	});

	test('rejects an unknown agent before inserting a session', async () => {
		const database = createTestDatabase();
		const services = await createServices(
			database,
			'opencode',
			() =>
				Effect.succeed({
					sessionId: 'ses_unused',
					text: 'done',
					stopReason: 'end_turn',
				}),
			{
				agentResolve: (agentType) =>
					Effect.fail(
						new AgentTypeNotFound({ agentType, configuredAgentTypes: [] }),
					),
			},
		);
		await expect(
			Effect.runPromise(
				services.sessions.start({
					title: 'Missing agent',
					prompt: 'first',
					cwd: '/repo',
					model: 'opencode:model',
					agentType: 'missing',
				}),
			),
		).rejects.toMatchObject({ _tag: 'AgentTypeNotFound' });
		expect(database.db.select().from(schema.sessions).all()).toHaveLength(0);
		database.sqlite.close();
	});
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
				title: 'First prompt',
				prompt: 'first prompt',
				cwd: '/repo',
				model: 'opencode:model-id',
				agentType: 'reviewer',
			}),
		);
		const stored = database.db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.uuid, started.sessionId))
			.get();
		expect(stored).toMatchObject({
			title: 'First prompt',
			backend: 'opencode',
			cwd: '/repo',
		});
		await turnStarted.promise;
		const blockingRead = Effect.runPromise(
			services.sessions.read({ sessionId: started.sessionId, wait: true }),
		);
		expect(
			await Effect.runPromise(
				services.sessions.read({ sessionId: started.sessionId }),
			),
		).toMatchObject({ status: 'running', jobId: started.jobId });
		releaseTurn.resolve();
		expect(await blockingRead).toMatchObject({
			status: 'done',
			jobId: started.jobId,
		});
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
			await Effect.runPromise(services.sessions.list({ cwd: '/repo' })),
		).toMatchObject([
			{
				id: started.sessionId,
				title: 'First prompt',
				jobId: continued.jobId,
				status: 'done',
				prompt: 'second prompt',
			},
		]);
		const otherSession = insertSession(database, {
			uuid: 'other-directory',
			title: 'Other task',
			backend: 'opencode',
			harnessSessionId: 'ses_other',
			cwd: '/elsewhere',
		});
		insertJob(database, otherSession, {
			uuid: 'other-job',
			status: 'done',
			prompt: 'other task',
			model: 'model-id',
		});
		expect(
			(await Effect.runPromise(services.sessions.list({ cwd: '/repo' }))).map(
				(session) => session.id,
			),
		).toEqual([started.sessionId]);
		expect(
			(await Effect.runPromise(services.sessions.list({}))).map(
				(session) => session.id,
			),
		).toContain('other-directory');
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

	test('lists sessions by root-job activity before limiting, with creation time preserved', async () => {
		const database = createTestDatabase();
		const services = await createServices(database, 'opencode', () =>
			Effect.die('Unexpected turn'),
		);
		const older = insertSession(database, {
			uuid: 'older',
			title: 'Older',
			backend: 'opencode',
			harnessSessionId: 'older',
			cwd: '/repo',
		});
		database.db
			.update(schema.sessions)
			.set({ created_at: new Date(1) })
			.where(eq(schema.sessions.id, older.id))
			.run();
		for (let index = 0; index < 101; index++) {
			const newer = insertSession(database, {
				uuid: `newer-${index}`,
				title: 'Newer',
				backend: 'opencode',
				harnessSessionId: `newer-${index}`,
				cwd: '/repo',
			});
			database.db
				.insert(schema.jobs)
				.values({
					uuid: `job-${index}`,
					session_id: newer.id,
					status: 'done',
					prompt: 'newer',
					created_at: new Date(200),
				})
				.run();
		}
		database.db
			.insert(schema.jobs)
			.values([
				{
					uuid: 'older-completed',
					session_id: older.id,
					status: 'done',
					prompt: 'completed',
					created_at: new Date(100),
					terminated_at: new Date(400),
				},
				{
					uuid: 'older-latest',
					session_id: older.id,
					status: 'done',
					prompt: 'latest',
					created_at: new Date(300),
					terminated_at: new Date(350),
				},
			])
			.run();
		const listed = await Effect.runPromise(services.sessions.list({}));
		expect(listed).toHaveLength(100);
		expect(listed[0]).toMatchObject({
			id: 'older',
			jobId: 'older-latest',
			createdAt: 1,
			lastActivityAt: 400,
		});
		expect(listed[1]).toMatchObject({ id: 'newer-100', lastActivityAt: 200 });
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
				title: 'Work session',
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
				title: 'Cursor work',
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
				title: 'First session',
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
				title: 'Long task',
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
			title: 'Source session',
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
				title: 'Continue full state',
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
				title: 'Continue earlier state',
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
		expect(forkedSession?.title).toBe('Continue full state');
		expect(earlierForkSession?.forked_from_job_id).toBe(earlierJob.id);
		expect(earlierForkSession?.title).toBe('Continue earlier state');
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
			title: 'Source without checkpoint',
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
					title: 'Fork without checkpoint',
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
