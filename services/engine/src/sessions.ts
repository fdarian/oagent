/// <reference types="bun" />

import { randomUUIDv7 } from 'bun';
import { and, desc, eq } from 'drizzle-orm';
import { Context, Effect, Layer, Schema } from 'effect';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { type Backend, parseBackend } from './harness.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { JobStartError, Jobs } from './jobs.ts';

type SessionRow = typeof schema.sessions.$inferSelect;
type JobRow = typeof schema.jobs.$inferSelect;

export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()(
	'SessionNotFound',
	{ sessionId: Schema.String },
) {
	override get message() {
		return `Session not found: ${this.sessionId}`;
	}
}

export class SessionNotReady extends Schema.TaggedError<SessionNotReady>()(
	'SessionNotReady',
	{ sessionId: Schema.String, message: Schema.String },
) {}

export class SessionStartError extends Schema.TaggedError<SessionStartError>()(
	'SessionStartError',
	{
		code: Schema.Literals(['MISSING_CWD']),
		message: Schema.String,
	},
) {}

export class SessionBusy extends Schema.TaggedError<SessionBusy>()(
	'SessionBusy',
	{
		sessionId: Schema.String,
		code: Schema.Literals(['UNSUPPORTED_BACKEND', 'TURN_IN_PROGRESS']),
		message: Schema.String,
	},
) {}

export class SessionForkError extends Schema.TaggedError<SessionForkError>()(
	'SessionForkError',
	{
		forkId: Schema.String,
		code: Schema.Literals([
			'NOT_FOUND',
			'SOURCE_NOT_READY',
			'UNSUPPORTED_BACKEND',
			'FORK_NOT_SUPPORTED',
			'MISSING_CHECKPOINT',
			'FORK_FAILED',
		]),
		message: Schema.String,
	},
) {}

export class SessionPersistenceError extends Schema.TaggedError<SessionPersistenceError>()(
	'SessionPersistenceError',
	{ message: Schema.String, cause: Schema.Defect() },
) {}

type StartInput = {
	prompt: string;
	cwd?: string;
	model?: string;
	agentType?: string;
	forkId?: string;
	worktree?: boolean;
	mcpSessionId?: string;
};

export class Sessions extends Context.Service<Sessions>()('oagent/Sessions', {
	make: Effect.gen(function* () {
		const dbService = yield* Db;
		const db = dbService.db;
		const jobs = yield* Jobs;
		const harnessRegistry = yield* HarnessRegistry;

		const insertSession = (input: {
			backend: Backend;
			harnessSessionId?: string;
			cwd: string;
			worktreePath?: string;
			worktreeBranch?: string;
			mcpSessionId?: string;
			forkedFromJobId?: number;
		}) =>
			Effect.try({
				try: () =>
					db
						.insert(schema.sessions)
						.values({
							uuid: randomUUIDv7(),
							backend: input.backend,
							harness_session_id: input.harnessSessionId,
							cwd: input.cwd,
							worktree_path: input.worktreePath,
							worktree_branch: input.worktreeBranch,
							mcp_session_id: input.mcpSessionId,
							forked_from_job_id: input.forkedFromJobId,
						})
						.returning()
						.get(),
				catch: (cause) =>
					new SessionPersistenceError({
						message: 'Could not persist the session.',
						cause,
					}),
			}).pipe(
				Effect.flatMap((session) =>
					session === undefined
						? new SessionPersistenceError({
								message: 'Could not persist the session.',
								cause: new Error('Session insert returned no row'),
							})
						: Effect.succeed(session),
				),
			);

		const findSession = (sessionId: string) =>
			Effect.sync(() =>
				db
					.select()
					.from(schema.sessions)
					.where(eq(schema.sessions.uuid, sessionId))
					.limit(1)
					.get(),
			).pipe(
				Effect.flatMap((session) =>
					session === undefined
						? new SessionNotFound({ sessionId })
						: Effect.succeed(session),
				),
			);

		const latestJob = (session: SessionRow) =>
			db
				.select()
				.from(schema.jobs)
				.where(eq(schema.jobs.session_id, session.id))
				.orderBy(desc(schema.jobs.created_at), desc(schema.jobs.id))
				.limit(1)
				.get();

		const findForkSource = (forkId: string) => {
			const sourceSession = db
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.uuid, forkId))
				.limit(1)
				.get();
			if (sourceSession !== undefined) {
				const job = latestJob(sourceSession);
				return { session: sourceSession, job, latestJob: job };
			}

			const job = db
				.select()
				.from(schema.jobs)
				.where(eq(schema.jobs.uuid, forkId))
				.limit(1)
				.get();
			if (job === undefined) return undefined;
			const session = db
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.id, job.session_id))
				.limit(1)
				.get();
			if (session === undefined) return undefined;
			return { session, job, latestJob: latestJob(session) };
		};

		const forkHarnessSession = (forkId: string) =>
			Effect.gen(function* () {
				const source = findForkSource(forkId);
				if (source === undefined) {
					return yield* new SessionForkError({
						forkId,
						code: 'NOT_FOUND',
						message: `Could not find a session or job with ID ${forkId}.`,
					});
				}
				if (source.job === undefined || source.latestJob === undefined) {
					return yield* new SessionForkError({
						forkId,
						code: 'SOURCE_NOT_READY',
						message: `Session ${source.session.uuid} has no completed turn to fork.`,
					});
				}
				if (source.session.harness_session_id === null) {
					return yield* new SessionForkError({
						forkId,
						code: 'SOURCE_NOT_READY',
						message: `Session ${source.session.uuid} does not have a harness session yet.`,
					});
				}
				const sourceHarnessSessionId = source.session.harness_session_id;
				const selectedJob = source.job;
				if (selectedJob.model === null) {
					return yield* new SessionForkError({
						forkId,
						code: 'SOURCE_NOT_READY',
						message: `Job ${selectedJob.uuid} has no recorded model to inherit.`,
					});
				}

				const backend = parseBackend(source.session.backend);
				const harness = harnessRegistry.get(backend);
				const isLatest = source.job.id === source.latestJob.id;
				const forked = isLatest
					? (() => {
							const forkSession = harness.forkSession;
							if (forkSession === undefined) {
								return Effect.fail(
									new SessionForkError({
										forkId,
										code: 'FORK_NOT_SUPPORTED',
										message: `The ${backend} backend does not support session forking.`,
									}),
								);
							}
							return forkSession({
								sessionId: sourceHarnessSessionId,
								cwd: source.session.cwd,
							}).pipe(
								Effect.mapError(
									(error) =>
										new SessionForkError({
											forkId,
											code: 'FORK_FAILED',
											message: error.message,
										}),
								),
							);
						})()
					: (() => {
							if (backend !== 'opencode') {
								return Effect.fail(
									new SessionForkError({
										forkId,
										code: 'UNSUPPORTED_BACKEND',
										message: `Forking from an earlier job is only supported for OpenCode sessions; ${backend} cannot fork at a prior turn.`,
									}),
								);
							}
							if (selectedJob.harness_last_message_id === null) {
								return Effect.fail(
									new SessionForkError({
										forkId,
										code: 'MISSING_CHECKPOINT',
										message: `Job ${forkId} has no OpenCode message checkpoint, so its earlier state cannot be forked.`,
									}),
								);
							}
							const getFirstMessageAfter = harness.getFirstMessageAfter;
							const forkSessionBefore = harness.forkSessionBefore;
							if (
								getFirstMessageAfter === undefined ||
								forkSessionBefore === undefined
							) {
								return Effect.fail(
									new SessionForkError({
										forkId,
										code: 'FORK_NOT_SUPPORTED',
										message: 'OpenCode REST session forking is unavailable.',
									}),
								);
							}
							return getFirstMessageAfter({
								sessionId: sourceHarnessSessionId,
								messageId: selectedJob.harness_last_message_id,
							}).pipe(
								Effect.flatMap((before) =>
									forkSessionBefore({
										sessionId: sourceHarnessSessionId,
										cwd: source.session.cwd,
										before,
									}),
								),
								Effect.mapError(
									(error) =>
										new SessionForkError({
											forkId,
											code: 'FORK_FAILED',
											message: error.message,
										}),
								),
							);
						})();

				const forkedSession = yield* forked;
				return {
					sourceSession: source.session,
					sourceJob: selectedJob,
					model: selectedJob.model,
					agentType: selectedJob.agent_type ?? undefined,
					backend,
					harnessSessionId: forkedSession.sessionId,
				};
			});

		const start = (input: StartInput) =>
			Effect.gen(function* () {
				const fork =
					input.forkId === undefined
						? undefined
						: yield* forkHarnessSession(input.forkId);
				const backend =
					fork === undefined
						? yield* jobs.resolveBackend(input.model)
						: fork.backend;
				const cwd = input.cwd ?? fork?.sourceSession.cwd;
				if (cwd === undefined) {
					return yield* new SessionStartError({
						code: 'MISSING_CWD',
						message: 'cwd is required when starting a new session.',
					});
				}
				const model =
					input.model ??
					(fork === undefined ? undefined : `${fork.backend}:${fork.model}`);
				const agentType = input.agentType ?? fork?.agentType;
				const session = yield* insertSession({
					backend,
					harnessSessionId: fork?.harnessSessionId,
					cwd,
					worktreePath: fork?.sourceSession.worktree_path ?? undefined,
					worktreeBranch: fork?.sourceSession.worktree_branch ?? undefined,
					mcpSessionId: input.mcpSessionId,
					forkedFromJobId: fork?.sourceJob.id,
				});
				const result = yield* jobs.start({
					session,
					prompt: input.prompt,
					model,
					agentType,
					worktree: input.worktree,
				});
				return { sessionId: session.uuid, ...result };
			});

		const sendMessage = (input: { sessionId: string; prompt: string }) =>
			Effect.gen(function* () {
				const session = yield* findSession(input.sessionId);
				const running = db
					.select()
					.from(schema.jobs)
					.where(
						and(
							eq(schema.jobs.session_id, session.id),
							eq(schema.jobs.status, 'running'),
						),
					)
					.orderBy(desc(schema.jobs.created_at), desc(schema.jobs.id))
					.limit(1)
					.get();
				if (running !== undefined) {
					if (session.backend !== 'opencode') {
						return yield* new SessionBusy({
							sessionId: session.uuid,
							code: 'UNSUPPORTED_BACKEND',
							message: `Session ${session.uuid} is busy on the ${session.backend} backend.`,
						});
					}
					yield* jobs.steer(running.uuid, input.prompt).pipe(
						Effect.mapError(
							(error) =>
								new SessionBusy({
									sessionId: session.uuid,
									code: 'TURN_IN_PROGRESS',
									message: error.message,
								}),
						),
					);
					return {
						sessionId: session.uuid,
						jobId: running.uuid,
						delivery: 'steered' as const,
					};
				}

				const latest = latestJob(session);
				if (latest === undefined || latest.model === null) {
					return yield* new SessionNotReady({
						sessionId: session.uuid,
						message: `Session ${session.uuid} has no prior turn from which to inherit a model.`,
					});
				}
				const result = yield* jobs
					.start({
						session,
						prompt: input.prompt,
						model: `${parseBackend(session.backend)}:${latest.model}`,
						agentType: latest.agent_type ?? undefined,
					})
					.pipe(
						Effect.mapError((error) =>
							error instanceof JobStartError &&
							error.code === 'SESSION_TURN_IN_PROGRESS'
								? new SessionBusy({
										sessionId: session.uuid,
										code: 'TURN_IN_PROGRESS',
										message: error.message,
									})
								: error,
						),
					);
				return {
					sessionId: session.uuid,
					...result,
					delivery: 'started' as const,
				};
			});

		const read = (input: { sessionId: string; timeoutMs?: number }) =>
			Effect.gen(function* () {
				const session = yield* findSession(input.sessionId);
				const job = latestJob(session);
				if (job === undefined) {
					return yield* new SessionNotReady({
						sessionId: session.uuid,
						message: `Session ${session.uuid} has no jobs to read.`,
					});
				}
				const result = yield* jobs.wait({
					jobId: job.uuid,
					timeoutMs: input.timeoutMs,
				});
				return { ...result, jobId: job.uuid };
			});

		const cancel = (input: { sessionId: string }) =>
			Effect.gen(function* () {
				const session = db
					.select()
					.from(schema.sessions)
					.where(eq(schema.sessions.uuid, input.sessionId))
					.limit(1)
					.get();
				if (session === undefined) return { ok: false as const };
				const running = db
					.select({ uuid: schema.jobs.uuid })
					.from(schema.jobs)
					.where(
						and(
							eq(schema.jobs.session_id, session.id),
							eq(schema.jobs.status, 'running'),
						),
					)
					.limit(1)
					.get();
				if (running !== undefined) {
					yield* jobs.cancel({ jobId: running.uuid });
					return { ok: true as const, status: 'cancelled' as const };
				}
				return { ok: true as const, status: 'idle' as const };
			});

		const list = (input: { mcpSessionId: string }) =>
			Effect.sync(() => {
				const rows = db
					.select()
					.from(schema.sessions)
					.where(eq(schema.sessions.mcp_session_id, input.mcpSessionId))
					.orderBy(desc(schema.sessions.created_at), desc(schema.sessions.id))
					.all();
				const sessions: Array<{
					id: string;
					jobId: string;
					status: JobRow['status'];
					prompt: string;
					createdAt: number;
				}> = [];
				for (const session of rows) {
					const job = latestJob(session);
					if (job === undefined) continue;
					sessions.push({
						id: session.uuid,
						jobId: job.uuid,
						status: job.status,
						prompt: job.prompt,
						createdAt: session.created_at.getTime(),
					});
				}
				return sessions;
			});

		const createSideChatSession = (input: {
			sourceJobId: number;
		}): Effect.Effect<SessionRow, SessionNotReady | SessionPersistenceError> =>
			Effect.gen(function* () {
				const sourceJob = db
					.select()
					.from(schema.jobs)
					.where(eq(schema.jobs.id, input.sourceJobId))
					.limit(1)
					.get();
				if (sourceJob === undefined) {
					return yield* new SessionNotReady({
						sessionId: String(input.sourceJobId),
						message: 'The source job for the side chat is no longer available.',
					});
				}
				const sourceSession = db
					.select()
					.from(schema.sessions)
					.where(eq(schema.sessions.id, sourceJob.session_id))
					.limit(1)
					.get();
				if (sourceSession === undefined) {
					return yield* new SessionNotReady({
						sessionId: sourceJob.uuid,
						message: 'The source session for the side chat is unavailable.',
					});
				}
				return yield* insertSession({
					backend: parseBackend(sourceSession.backend),
					cwd: sourceSession.cwd,
					worktreePath: sourceSession.worktree_path ?? undefined,
					worktreeBranch: sourceSession.worktree_branch ?? undefined,
					forkedFromJobId: sourceJob.id,
				});
			});

		const findSideChatSession = (harnessSessionId: string) =>
			Effect.sync(() =>
				db
					.select()
					.from(schema.sessions)
					.where(eq(schema.sessions.harness_session_id, harnessSessionId))
					.limit(1)
					.get(),
			);

		return {
			start,
			sendMessage,
			read,
			cancel,
			list,
			createSideChatSession,
			findSideChatSession,
		};
	}),
}) {
	static readonly layer = Layer.effect(Sessions, Sessions.make).pipe(
		Layer.provide(Jobs.layer),
		Layer.provide(HarnessRegistry.layer),
		Layer.provide(Db.layer),
	);
}
