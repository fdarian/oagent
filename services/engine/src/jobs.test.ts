import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Effect, Fiber, Scope } from 'effect';
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

test.each([null, process.pid])(
	'scope shutdown preserves the running row and recovery finishes the same job with runner_pid=%s',
	async (runnerPid) => {
		const database = createDatabase();
		const shutdownEvents: string[] = [];
		const session = insertSession(database, {
			uuid: 'shutdown-session',
			title: 'Shutdown',
			cwd: '/tmp',
		});
		database.db
			.update(schema.sessions)
			.set({ harness_session_id: 'ses_shutdown' })
			.where(eq(schema.sessions.id, session.id))
			.run();
		const make = (harness: Harness) =>
			Jobs.make.pipe(
				Effect.provideService(Db, database),
				Effect.provideService(HarnessRegistry, createHarnessRegistry(harness)),
				Effect.provideService(Agents, {} as Agents['Service']),
				Effect.provideService(Worktrees, {} as Worktrees['Service']),
			);
		const jobId = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const jobs = yield* make({
						backend: 'opencode',
						runTurn: () => Effect.never,
					} as unknown as Harness);
					const started = yield* jobs.start({
						session,
						prompt: 'original',
						model: 'opencode:test#high',
					});
					jobs.subscribe(started.jobId, (payload) => {
						shutdownEvents.push(payload.type);
					});
					yield* Effect.sleep(10);
					return started.jobId;
				}),
			),
		);
		const interrupted = database.db
			.select()
			.from(schema.jobs)
			.where(eq(schema.jobs.uuid, jobId))
			.get();
		expect(interrupted?.status).toBe('running');
		expect(interrupted?.interrupted_at).toBeInstanceOf(Date);
		expect(interrupted?.terminated_at).toBeNull();
		expect(shutdownEvents).toEqual(['shutdown']);
		database.db
			.update(schema.jobs)
			.set({ runner_pid: runnerPid })
			.where(eq(schema.jobs.uuid, jobId))
			.run();
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const jobs = yield* make({
						backend: 'opencode',
						runTurn: (input: {
							model?: string;
							reasoningEffort?: string;
							sessionId?: string;
						}) => {
							expect(input.model).toBe('test');
							expect(input.reasoningEffort).toBe('high');
							expect(input.sessionId).toBe('ses_shutdown');
							return Effect.succeed({
								sessionId: 'ses_shutdown',
								text: 'resumed',
								stopReason: 'end_turn',
							});
						},
					} as unknown as Harness);
					expect((yield* jobs.wait({ jobId, timeoutMs: 1_000 })).status).toBe(
						'done',
					);
				}),
			),
		);
		expect(database.db.select().from(schema.jobs).get()?.resume_count).toBe(1);
		database.sqlite.close();
	},
);

describe('start model reasoning effort', () => {
	const cases = [
		{ model: 'opencode:test', expectedModel: 'test', expectedEffort: null },
		{
			model: 'opencode:test#medium',
			expectedModel: 'test',
			expectedEffort: 'medium',
		},
		{ model: 'general#high', expectedModel: 'test', expectedEffort: 'high' },
		{ model: 'general', expectedModel: 'test', expectedEffort: 'low' },
		{
			model: 'general#high',
			explicitEffort: 'maximum',
			expectedModel: 'test',
			expectedEffort: 'maximum',
		},
	];

	for (const entry of cases) {
		test(`resolves ${entry.model}`, async () => {
			const database = createDatabase();
			database.db
				.insert(schema.modelAliases)
				.values({
					name: 'general',
					backend: 'opencode',
					model_id: 'test',
					reasoning_effort: 'low',
				})
				.run();
			const efforts: Array<string | undefined> = [];
			const harness = {
				backend: 'opencode' as const,
				runTurn: (input: { reasoningEffort?: string }) =>
					Effect.sync(() => {
						efforts.push(input.reasoningEffort);
						return {
							sessionId: 'ses_model',
							text: 'done',
							stopReason: 'end_turn',
						};
					}),
			} as unknown as Harness;
			const jobs = await Effect.runPromise(
				Jobs.make.pipe(
					Effect.provideService(Scope.Scope, Effect.runSync(Scope.make())),
					Effect.provideService(Db, {
						db: database.db,
						sqlite: database.sqlite,
					} as unknown as Db['Service']),
					Effect.provideService(
						HarnessRegistry,
						createHarnessRegistry(harness),
					),
					Effect.provideService(Agents, {} as Agents['Service']),
					Effect.provideService(Worktrees, {} as Worktrees['Service']),
				),
			);
			const session = insertSession(database, {
				uuid: 'session-model',
				title: 'Model session',
				cwd: '/tmp',
			});
			const started = await Effect.runPromise(
				jobs.start({
					session,
					prompt: 'run',
					model: entry.model,
					reasoningEffort: entry.explicitEffort,
				}),
			);
			await Effect.runPromise(
				jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
			);
			const job = database.db
				.select()
				.from(schema.jobs)
				.where(eq(schema.jobs.uuid, started.jobId))
				.get();
			expect(job?.model).toBe(entry.expectedModel);
			expect(job?.reasoning_effort).toBe(entry.expectedEffort);
			expect(efforts).toEqual([
				entry.expectedEffort === null ? undefined : entry.expectedEffort,
			]);
			database.sqlite.close();
		});
	}

	for (const model of [
		'opencode:test#',
		'general#',
		'cursor:test#high',
		'grok:test#high',
		'unsupported#high',
	]) {
		test(`rejects ${model}`, async () => {
			const database = createDatabase();
			database.db
				.insert(schema.modelAliases)
				.values({
					name: 'unsupported',
					backend: 'cursor',
					model_id: 'test',
				})
				.run();
			const harness = { backend: 'opencode' } as Harness;
			const jobs = await Effect.runPromise(
				Jobs.make.pipe(
					Effect.provideService(Scope.Scope, Effect.runSync(Scope.make())),
					Effect.provideService(Db, {
						db: database.db,
						sqlite: database.sqlite,
					} as unknown as Db['Service']),
					Effect.provideService(
						HarnessRegistry,
						createHarnessRegistry(harness),
					),
					Effect.provideService(Agents, {} as Agents['Service']),
					Effect.provideService(Worktrees, {} as Worktrees['Service']),
				),
			);
			const session = insertSession(database, {
				uuid: 'session-model',
				title: 'Model session',
				cwd: '/tmp',
			});
			const exit = await Effect.runPromiseExit(
				jobs.start({ session, prompt: 'run', model }),
			);
			expect(exit._tag).toBe('Failure');
			if (exit._tag === 'Failure')
				expect(String(exit.cause)).toContain('ModelResolutionError');
			database.sqlite.close();
		});
	}
});

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
				Effect.provideService(Scope.Scope, Effect.runSync(Scope.make())),
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

	test('round-trips every SessionUpdate variant added after ACP 0.22', async () => {
		const database = createDatabase();
		const text = { type: 'text' as const, text: 'hello' };
		const events = [
			{
				sessionUpdate: 'tool_call',
				toolCallId: 'tc1',
				name: 'bash',
				title: 'Run',
			},
			{ sessionUpdate: 'tool_call', toolCallId: 'tc2', title: 'No name' },
			{
				sessionUpdate: 'plan_update',
				plan: {
					type: 'items',
					planId: 'p1',
					entries: [{ content: 'a', priority: 'high', status: 'pending' }],
				},
			},
			{
				sessionUpdate: 'plan_update',
				plan: { type: 'file', planId: 'p2', uri: 'file:///plan.md' },
			},
			{
				sessionUpdate: 'plan_update',
				plan: { type: 'markdown', planId: 'p3', content: '# plan' },
			},
			{ sessionUpdate: 'plan_removed', planId: 'p1' },
			{
				sessionUpdate: 'compaction_update',
				compactionId: 'c1',
				status: 'completed',
				summary: [text],
			},
			{
				sessionUpdate: 'compaction_update',
				compactionId: 'c2',
				status: 'failed',
				error: 'boom',
			},
			{
				sessionUpdate: 'compaction_summary_chunk',
				compactionId: 'c1',
				content: text,
			},
			{
				sessionUpdate: 'notice',
				severity: 'warning',
				title: 'Heads up',
				description: 'details',
			},
			{
				sessionUpdate: 'subagent_update',
				sessionId: 'child',
				title: 'Child',
				description: 'does things',
				capabilities: { cancel: {} },
				state: {
					state: 'idle',
					stopReason: 'end_turn',
					usage: { totalTokens: 3, inputTokens: 1, outputTokens: 2 },
				},
			},
			{
				sessionUpdate: 'subagent_update',
				sessionId: 'child',
				state: { state: 'custom_state', detail: 'x' },
			},
			{
				sessionUpdate: 'session_message',
				messageId: 'm1',
				senderSessionId: 's1',
				recipientSessionId: 's2',
				content: [text],
			},
			{
				sessionUpdate: 'session_message_chunk',
				messageId: 'm1',
				senderSessionId: 's1',
				content: text,
			},
			{
				sessionUpdate: 'compaction_update',
				compactionId: 'c3',
				status: 'completed',
				summary: null,
				error: null,
			},
			{
				sessionUpdate: 'notice',
				severity: 'info',
				title: 'Cleared',
				description: null,
			},
			{
				sessionUpdate: 'subagent_update',
				sessionId: 'child',
				title: null,
				description: null,
				capabilities: null,
				state: null,
			},
			{
				sessionUpdate: 'session_message',
				messageId: 'm2',
				senderSessionId: null,
				recipientSessionId: null,
				content: null,
			},
			{
				sessionUpdate: 'session_message_chunk',
				messageId: 'm2',
				senderSessionId: null,
				recipientSessionId: null,
				content: text,
			},
		] as const;
		const harness = {
			backend: 'opencode' as const,
			runTurn: (input: { onEvent?: (value: unknown) => void }) =>
				Effect.sync(() => {
					for (const event of events) input.onEvent?.(event);
					return { sessionId: 'ses_test', text: '', stopReason: 'end_turn' };
				}),
		} as unknown as Harness;
		const dbService = {
			db: database.db,
			sqlite: database.sqlite,
		} as unknown as Db['Service'];
		const jobs = await Effect.runPromise(
			Jobs.make.pipe(
				Effect.provideService(Scope.Scope, Effect.runSync(Scope.make())),
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
			uuid: 'session-new-variants',
			title: 'New variants',
			cwd: '/tmp',
		});
		const started = await Effect.runPromise(
			jobs.start({ session, prompt: 'run', model: 'opencode:test' }),
		);
		await Effect.runPromise(
			jobs.wait({ jobId: started.jobId, timeoutMs: 1_000 }),
		);

		const page = jobs.readEventsPage(started.jobId, 0, 100);
		expect(page.events.map((entry) => entry.event)).toEqual(
			events.map((event) => expect.objectContaining(event)),
		);
		expect(page.events[1]?.event).not.toHaveProperty('name', expect.anything());

		const byIndex = (index: number) =>
			page.events[index]?.event as unknown as Record<string, unknown>;
		// omitted stays omitted (undefined), explicit null stays null
		expect(byIndex(7).summary).toBeUndefined();
		expect(byIndex(7).error).toBe('boom');
		expect(byIndex(14).summary).toBeNull();
		expect(byIndex(14).error).toBeNull();
		expect(byIndex(9).description).toBe('details');
		expect(byIndex(15).description).toBeNull();
		expect(byIndex(11).title).toBeUndefined();
		expect(byIndex(11).capabilities).toBeUndefined();
		expect(byIndex(16).title).toBeNull();
		expect(byIndex(16).state).toBeNull();
		expect(byIndex(16).capabilities).toBeNull();
		expect(byIndex(13).recipientSessionId).toBeUndefined();
		expect(byIndex(17).content).toBeNull();
		expect(byIndex(17).senderSessionId).toBeNull();
		expect(byIndex(18).recipientSessionId).toBeNull();
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
			Effect.provideService(Scope.Scope, Effect.runSync(Scope.make())),
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
			Effect.provideService(Scope.Scope, Effect.runSync(Scope.make())),
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
			Effect.provideService(Scope.Scope, Effect.runSync(Scope.make())),
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
			Effect.provideService(Scope.Scope, Effect.runSync(Scope.make())),
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
