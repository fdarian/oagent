import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Effect, Scope } from 'effect';
import { Agents, AgentTypeNotFound } from './agents.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { type Backend, type Harness, HarnessSteerError } from './harness.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { Jobs } from './jobs.ts';
import { Sessions } from './sessions.ts';
import { Settings } from './settings.ts';
import { createTestDatabase } from './test-database.ts';
import { WorktreeError, Worktrees } from './worktree.ts';

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
		ensureWorktreesEnabled?: Worktrees['Service']['ensureEnabled'];
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
		builtin: () => harness,
		resolve: () => Effect.succeed(harness),
		resolveForSession: () => Effect.succeed(harness),
		supportsModelSwitch: () => harness.supportsModelSwitch,
		list: () => Effect.succeed([harness]),
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
		ensureEnabled: options?.ensureWorktreesEnabled ?? (() => Effect.void),
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
				Effect.provideService(Worktrees, worktrees),
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
		originCwd?: string;
		worktreePath?: string;
		worktreeBranch?: string;
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
			origin_cwd: input.originCwd ?? input.cwd,
			worktree_path: input.worktreePath,
			worktree_branch: input.worktreeBranch,
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

	test('rejects a worktree request before inserting a session when worktrees are disabled', async () => {
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
				ensureWorktreesEnabled: () =>
					Effect.fail(
						new WorktreeError({ message: 'Worktrees are disabled.' }),
					),
			},
		);
		await expect(
			Effect.runPromise(
				services.sessions.start({
					title: 'Disabled worktree',
					prompt: 'first',
					cwd: '/repo',
					model: 'opencode:model',
					worktree: {},
				}),
			),
		).rejects.toMatchObject({ _tag: 'WorktreeError' });
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
			services.sessions.result({ sessionId: started.sessionId, wait: true }),
		);
		expect(
			await Effect.runPromise(
				services.sessions.result({ sessionId: started.sessionId }),
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
				services.sessions.result({ sessionId: started.sessionId }),
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
		const nested = insertSession(database, {
			uuid: 'nested-directory',
			title: 'Nested task',
			backend: 'opencode',
			harnessSessionId: 'ses_nested',
			cwd: '/repo/packages/api',
		});
		const sibling = insertSession(database, {
			uuid: 'sibling-directory',
			title: 'Sibling task',
			backend: 'opencode',
			harnessSessionId: 'ses_sibling',
			cwd: '/repo2',
		});
		const worktree = insertSession(database, {
			uuid: 'worktree-directory',
			title: 'Worktree task',
			backend: 'opencode',
			harnessSessionId: 'ses_worktree',
			cwd: '/worktrees/feature',
			originCwd: '/repo/apps/web',
			worktreePath: '/worktrees/feature',
			worktreeBranch: 'feature',
		});
		const wildcard = insertSession(database, {
			uuid: 'wildcard-directory',
			title: 'Wildcard task',
			backend: 'opencode',
			harnessSessionId: 'ses_wildcard',
			cwd: '/repo_x',
		});
		for (const session of [nested, sibling, worktree, wildcard]) {
			insertJob(database, session, {
				uuid: `${session.uuid}-job`,
				status: 'done',
				prompt: session.title,
				model: 'model-id',
			});
		}
		const listIds = async (cwd: string) =>
			(await Effect.runPromise(services.sessions.list({ cwd })))
				.map((session) => session.id)
				.sort();
		expect(await listIds('/repo')).toEqual(
			[started.sessionId, 'nested-directory', 'worktree-directory'].sort(),
		);
		expect(await listIds('/repo/')).toEqual(await listIds('/repo'));
		expect(await listIds('/repo/apps/web')).toEqual(['worktree-directory']);
		expect(await listIds('/worktrees')).toEqual(['worktree-directory']);
		expect(await listIds('/repo2')).toEqual(['sibling-directory']);
		expect(await listIds('/repo_')).toEqual([]);
		expect(await listIds('/repo%')).toEqual([]);
		expect(await listIds('/')).toHaveLength(
			(await Effect.runPromise(services.sessions.list({}))).length,
		);
		const listed = await Effect.runPromise(
			services.sessions.list({ cwd: '/repo/apps/web' }),
		);
		expect(listed).toMatchObject([
			{
				cwd: '/worktrees/feature',
				originCwd: '/repo/apps/web',
				worktreePath: '/worktrees/feature',
				worktreeBranch: 'feature',
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

	test('steers a running Claude turn through the harness', async () => {
		const database = createTestDatabase();
		const turnStarted = Promise.withResolvers<void>();
		const releaseTurn = Promise.withResolvers<void>();
		const steered: string[] = [];
		const services = await createServices(
			database,
			'claude',
			(input) =>
				Effect.promise(async () => {
					input.onSessionId?.('ses_claude');
					turnStarted.resolve();
					await releaseTurn.promise;
					return {
						sessionId: input.sessionId ?? 'ses_claude',
						text: 'done',
						stopReason: 'end_turn',
					};
				}),
			{
				steer: (input) =>
					Effect.sync(() => {
						steered.push(`${input.sessionId}:${input.text}`);
						return { messageId: 'msg-steered', text: input.text };
					}),
			},
		);
		const started = await Effect.runPromise(
			services.sessions.start({
				title: 'Claude session',
				prompt: 'work',
				cwd: '/repo',
				model: 'claude:model',
			}),
		);
		await turnStarted.promise;
		const result = await Effect.runPromise(
			services.sessions.sendMessage({
				sessionId: started.sessionId,
				prompt: 'also check tests',
			}),
		);
		expect(result).toEqual({
			sessionId: started.sessionId,
			jobId: started.jobId,
			delivery: 'steered',
		});
		expect(steered).toEqual(['ses_claude:also check tests']);
		releaseTurn.resolve();
		await Effect.runPromise(
			services.jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
		);
		database.sqlite.close();
	});

	test('starts a new Claude turn when steering reports no running turn', async () => {
		const database = createTestDatabase();
		const firstStarted = Promise.withResolvers<void>();
		const finishFirst = Promise.withResolvers<void>();
		const prompts: string[] = [];
		const services = await createServices(
			database,
			'claude',
			(input) =>
				Effect.promise(async () => {
					prompts.push(input.prompt);
					input.onSessionId?.('ses_claude');
					if (prompts.length === 1) {
						firstStarted.resolve();
						await finishFirst.promise;
					}
					return {
						sessionId: 'ses_claude',
						text: 'done',
						stopReason: 'end_turn',
					};
				}),
			{
				steer: () =>
					Effect.fail(
						new HarnessSteerError({
							code: 'NOT_RUNNING',
							message: 'No turn is running.',
							cause: new Error('promptRequired'),
						}),
					),
			},
		);
		const started = await Effect.runPromise(
			services.sessions.start({
				title: 'Claude session',
				prompt: 'first',
				cwd: '/repo',
				model: 'claude:model',
			}),
		);
		await firstStarted.promise;
		const followUp = Effect.runPromise(
			services.sessions.sendMessage({
				sessionId: started.sessionId,
				prompt: 'second',
			}),
		);
		finishFirst.resolve();
		const result = await followUp;
		expect(result.delivery).toBe('started');
		await Effect.runPromise(
			services.jobs.wait({ jobId: result.jobId, timeoutMs: 1_000 }),
		);
		expect(prompts).toEqual(['first', 'second']);
		database.sqlite.close();
	});

	test('rejects a busy Claude send as unsupported when the adapter cannot steer', async () => {
		const database = createTestDatabase();
		const turnStarted = Promise.withResolvers<void>();
		const releaseTurn = Promise.withResolvers<void>();
		const services = await createServices(
			database,
			'claude',
			(input) =>
				Effect.promise(async () => {
					input.onSessionId?.('ses_claude');
					turnStarted.resolve();
					await releaseTurn.promise;
					return {
						sessionId: 'ses_claude',
						text: 'done',
						stopReason: 'end_turn',
					};
				}),
			{
				steer: () =>
					Effect.fail(
						new HarnessSteerError({
							code: 'UNSUPPORTED_VERSION',
							message: 'The adapter does not support steering; upgrade it.',
							cause: new Error('unsupported'),
						}),
					),
			},
		);
		const started = await Effect.runPromise(
			services.sessions.start({
				title: 'Claude session',
				prompt: 'work',
				cwd: '/repo',
				model: 'claude:model',
			}),
		);
		await turnStarted.promise;
		await expect(
			Effect.runPromise(
				services.sessions.sendMessage({
					sessionId: started.sessionId,
					prompt: 'steer this',
				}),
			),
		).rejects.toMatchObject({
			_tag: 'SessionBusy',
			code: 'UNSUPPORTED_BACKEND',
			message: expect.stringContaining('upgrade it'),
		});
		releaseTurn.resolve();
		await Effect.runPromise(
			services.jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
		);
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
				services.sessions.result({
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
				services.sessions.result({ sessionId: started.sessionId }),
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
			cwd: '/worktrees/source',
			originCwd: '/repo',
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
		expect(forkedSession?.cwd).toBe('/worktrees/source');
		expect(forkedSession?.origin_cwd).toBe('/repo');
		const forkedElsewhere = await Effect.runPromise(
			services.sessions.start({
				title: 'Continue elsewhere',
				prompt: 'continue elsewhere',
				forkId: sourceSession.uuid,
				cwd: '/elsewhere',
			}),
		);
		await Effect.runPromise(
			services.jobs.wait({ jobId: forkedElsewhere.jobId, timeoutMs: 1_000 }),
		);
		expect(
			database.db
				.select({
					cwd: schema.sessions.cwd,
					origin_cwd: schema.sessions.origin_cwd,
				})
				.from(schema.sessions)
				.where(eq(schema.sessions.uuid, forkedElsewhere.sessionId))
				.get(),
		).toEqual({ cwd: '/elsewhere', origin_cwd: '/elsewhere' });
		expect(earlierForkSession?.forked_from_job_id).toBe(earlierJob.id);
		expect(earlierForkSession?.title).toBe('Continue earlier state');
		expect(firstMessageLookups).toEqual(['msg-last-first-turn']);
		expect(beforeForks).toEqual(['msg-after-first-turn']);
		expect(calls).toEqual([
			{ sessionId: 'ses_acp_fork', model: 'second-model' },
			{ sessionId: 'ses_rest_fork', model: 'first-model' },
			{ sessionId: 'ses_acp_fork', model: 'second-model' },
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

describe('session history', () => {
	async function setup() {
		const database = createTestDatabase();
		const services = await createServices(database, 'opencode', () =>
			Effect.succeed({
				sessionId: 'harness',
				text: 'x',
				stopReason: 'end_turn',
			}),
		);
		const session = insertSession(database, {
			uuid: 'history-session',
			title: 'History',
			backend: 'opencode',
			harnessSessionId: 'harness',
			cwd: '/repo',
		});
		let created = 0;
		const addJob = (
			uuid: string,
			input: Partial<typeof schema.jobs.$inferInsert> = {},
		) => {
			created += 1;
			const job = database.db
				.insert(schema.jobs)
				.values({
					uuid,
					session_id: session.id,
					status: 'done',
					prompt: `prompt ${uuid}`,
					text: `text ${uuid}`,
					created_at: new Date(1_000 + created),
					...input,
				})
				.returning()
				.get();
			if (job === undefined) throw new Error('Expected inserted job');
			return job;
		};
		const addEvent = (
			job: typeof schema.jobs.$inferSelect,
			type: 'agent_message_chunk' | 'tool_call' | 'tool_call_update',
			variant:
				| { text: string }
				| {
						toolCallId: string;
						title?: string;
						kind?: 'read' | 'edit' | 'execute';
				  },
		) => {
			const event = database.db
				.insert(schema.events)
				.values({ job_id: job.id, type })
				.returning()
				.get();
			if (event === undefined) throw new Error('Expected inserted event');
			if ('text' in variant) {
				database.db
					.insert(schema.chunkEvents)
					.values({
						event_id: event.id,
						content: { type: 'text', text: variant.text },
					})
					.run();
				return;
			}
			database.db
				.insert(schema.toolCallEvents)
				.values({
					event_id: event.id,
					tool_call_id: variant.toolCallId,
					title: variant.title,
					kind: variant.kind,
				})
				.run();
		};
		const history = (input: Parameters<typeof services.sessions.history>[0]) =>
			Effect.runPromise(services.sessions.history(input));
		const fail = (input: Parameters<typeof services.sessions.history>[0]) =>
			Effect.runPromise(Effect.flip(services.sessions.history(input)));
		return { database, services, session, addJob, addEvent, history, fail };
	}

	test('pages turns newest-first with before and reports numbering', async () => {
		const t = await setup();
		for (let index = 1; index <= 12; index++) t.addJob(`job-${index}`);

		const first = await t.history({ sessionId: 'history-session' });
		if (first.view !== 'turns') throw new Error('Expected turns view');
		expect(first.total).toBe(12);
		expect(first.firstNumber).toBe(3);
		expect(first.turns.map((turn) => turn.jobId)).toEqual(
			Array.from({ length: 10 }, (_, index) => `job-${index + 3}`),
		);
		expect(first.turns[0]).toMatchObject({
			number: 3,
			status: 'done',
			prompt: 'prompt job-3',
			text: 'text job-3',
			errorMessage: null,
			toolCalls: {},
		});
		expect(first.before).toBe('job-3');
		expect(first.session).toEqual({
			id: 'history-session',
			title: 'History',
			status: 'idle',
		});
		expect(first.forkedFromJobId).toBeNull();

		const second = await t.history({
			sessionId: 'history-session',
			before: 'job-3',
		});
		if (second.view !== 'turns') throw new Error('Expected turns view');
		expect(second.turns.map((turn) => turn.jobId)).toEqual(['job-1', 'job-2']);
		expect(second.firstNumber).toBe(1);
		expect(second.before).toBeNull();

		const empty = await t.history({
			sessionId: 'history-session',
			before: 'job-1',
		});
		if (empty.view !== 'turns') throw new Error('Expected turns view');
		expect(empty.turns).toEqual([]);
		expect(empty.before).toBeNull();
		t.database.sqlite.close();
	});

	test('applies the limit default and maximum', async () => {
		const t = await setup();
		for (let index = 1; index <= 60; index++) t.addJob(`job-${index}`);

		const small = await t.history({ sessionId: 'history-session', limit: 2 });
		if (small.view !== 'turns') throw new Error('Expected turns view');
		expect(small.turns.map((turn) => turn.jobId)).toEqual(['job-59', 'job-60']);
		expect(small.before).toBe('job-59');

		const capped = await t.history({
			sessionId: 'history-session',
			limit: 500,
		});
		if (capped.view !== 'turns') throw new Error('Expected turns view');
		expect(capped.turns).toHaveLength(50);
		expect(capped.firstNumber).toBe(11);
		t.database.sqlite.close();
	});

	test('excludes side-chat jobs from turns, numbering and totals', async () => {
		const t = await setup();
		const first = t.addJob('root-1');
		const sideChat = t.database.db
			.insert(schema.sideChats)
			.values({ uuid: 'side', source_job_id: first.id, session_id: 'x' })
			.returning()
			.get();
		if (sideChat === undefined) throw new Error('Expected side chat');
		const side = t.addJob('side-job', { side_chat_id: sideChat.id });
		t.addEvent(side, 'agent_message_chunk', { text: 'side text' });
		t.addJob('root-2');

		const turns = await t.history({ sessionId: 'history-session' });
		if (turns.view !== 'turns') throw new Error('Expected turns view');
		expect(turns.total).toBe(2);
		expect(turns.turns.map((turn) => [turn.number, turn.jobId])).toEqual([
			[1, 'root-1'],
			[2, 'root-2'],
		]);
		expect(
			await t.fail({ sessionId: 'history-session', jobId: 'side-job' }),
		).toMatchObject({ _tag: 'SessionJobNotFound', jobId: 'side-job' });
		expect(
			await t.fail({ sessionId: 'history-session', before: 'side-job' }),
		).toMatchObject({ _tag: 'SessionJobNotFound' });
		t.database.sqlite.close();
	});

	test('reports a running session and expands a running turn', async () => {
		const t = await setup();
		t.addJob('done-1');
		const running = t.addJob('running-2', { status: 'running', text: null });
		t.addEvent(running, 'agent_message_chunk', { text: 'working' });
		t.addEvent(running, 'agent_message_chunk', { text: ' on it' });
		t.addEvent(running, 'tool_call', {
			toolCallId: 'c1',
			title: 'ls',
			kind: 'execute',
		});

		const turns = await t.history({ sessionId: 'history-session' });
		expect(turns.session.status).toBe('running');
		if (turns.view !== 'turns') throw new Error('Expected turns view');
		expect(turns.turns[1]).toMatchObject({
			status: 'running',
			text: null,
			toolCalls: { execute: 1 },
		});

		const turn = await t.history({
			sessionId: 'history-session',
			jobId: 'running-2',
		});
		if (turn.view !== 'turn') throw new Error('Expected turn view');
		expect(turn.total).toBe(2);
		expect(turn.turn.number).toBe(2);
		expect(turn.turn.entries).toEqual([
			{ type: 'assistant', text: 'working on it' },
			{ type: 'tool', title: 'ls', kind: 'execute', status: null },
		]);
		t.database.sqlite.close();
	});

	test('counts distinct tool calls by kind with null kind as other', async () => {
		const t = await setup();
		const job = t.addJob('counted');
		t.addEvent(job, 'tool_call', { toolCallId: 'a', kind: 'execute' });
		t.addEvent(job, 'tool_call', { toolCallId: 'b', kind: 'execute' });
		t.addEvent(job, 'tool_call', { toolCallId: 'c', kind: 'edit' });
		t.addEvent(job, 'tool_call', { toolCallId: 'd' });
		t.addEvent(job, 'tool_call_update', { toolCallId: 'a', kind: 'read' });
		t.addEvent(job, 'tool_call', { toolCallId: 'a', kind: 'execute' });

		const turns = await t.history({ sessionId: 'history-session' });
		if (turns.view !== 'turns') throw new Error('Expected turns view');
		expect(turns.turns[0]?.toolCalls).toEqual({
			execute: 2,
			edit: 1,
			other: 1,
		});
		t.database.sqlite.close();
	});

	test('pages events by id even when created_at runs backwards', async () => {
		const t = await setup();
		const job = t.addJob('skewed');
		for (let index = 0; index < 5; index++) {
			const event = t.database.db
				.insert(schema.events)
				.values({
					job_id: job.id,
					type: 'agent_message_chunk',
					created_at: new Date(10_000 - index),
				})
				.returning()
				.get();
			if (event === undefined) throw new Error('Expected inserted event');
			t.database.db
				.insert(schema.chunkEvents)
				.values({
					event_id: event.id,
					content: { type: 'text', text: String(index) },
				})
				.run();
		}

		const texts: string[] = [];
		let cursor = 0;
		for (;;) {
			const page = t.services.jobs.readEventsPage('skewed', cursor, 2);
			for (const entry of page.events) {
				if (entry.event.sessionUpdate !== 'agent_message_chunk') continue;
				if (entry.event.content.type !== 'text') continue;
				texts.push(entry.event.content.text);
			}
			if (page.nextCursor === null) break;
			cursor = page.nextCursor;
		}
		expect(texts).toEqual(['0', '1', '2', '3', '4']);
		t.database.sqlite.close();
	});

	test('rejects unknown session, job and before ids', async () => {
		const t = await setup();
		t.addJob('only');
		expect(await t.fail({ sessionId: 'missing' })).toMatchObject({
			_tag: 'SessionNotFound',
		});
		expect(
			await t.fail({ sessionId: 'history-session', jobId: 'nope' }),
		).toMatchObject({ _tag: 'SessionJobNotFound', jobId: 'nope' });
		expect(
			await t.fail({ sessionId: 'history-session', before: 'nope' }),
		).toMatchObject({ _tag: 'SessionJobNotFound', jobId: 'nope' });
		t.database.sqlite.close();
	});

	test('rejects jobId combined with limit or before', async () => {
		const t = await setup();
		t.addJob('only');
		expect(
			await t.fail({ sessionId: 'history-session', jobId: 'only', limit: 3 }),
		).toMatchObject({ _tag: 'InvalidHistoryQuery' });
		expect(
			await t.fail({
				sessionId: 'history-session',
				jobId: 'only',
				before: 'only',
			}),
		).toMatchObject({ _tag: 'InvalidHistoryQuery' });
		t.database.sqlite.close();
	});

	test('resolves the fork source to the job uuid', async () => {
		const t = await setup();
		const source = t.addJob('source-job');
		const fork = insertSession(t.database, {
			uuid: 'fork-session',
			title: 'Fork',
			backend: 'opencode',
			harnessSessionId: 'fork-harness',
			cwd: '/repo',
		});
		t.database.db
			.update(schema.sessions)
			.set({ forked_from_job_id: source.id })
			.where(eq(schema.sessions.id, fork.id))
			.run();
		t.database.db
			.insert(schema.jobs)
			.values({
				uuid: 'fork-job',
				session_id: fork.id,
				status: 'done',
				prompt: 'p',
				text: 't',
			})
			.run();

		const result = await t.history({ sessionId: 'fork-session' });
		expect(result.forkedFromJobId).toBe('source-job');
		expect(result.session.id).toBe('fork-session');
		t.database.sqlite.close();
	});
});
