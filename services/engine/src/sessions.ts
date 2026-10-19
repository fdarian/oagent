/// <reference types="bun" />

import { randomUUIDv7 } from 'bun';
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	inArray,
	isNull,
	or,
	sql,
} from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { Context, Effect, Layer, Schema } from 'effect';
import { AcpForkNotSupportedError } from './acp-agent.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import {
	type AcpCommand,
	type HarnessId,
	INLINE_ACP_HARNESS_ID,
	sessionModelInput,
} from './harness.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { HISTORY_DEFAULT_LIMIT } from './history/limits.ts';
import { foldTimeline, type TimelineEntry } from './history/timeline.ts';
import { JobStartError, Jobs } from './jobs.ts';
import { type WorktreeRequest, Worktrees } from './worktree.ts';

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
		code: Schema.Literals([
			'MISSING_CWD',
			'CONFLICTING_AGENT',
			'ACP_WITH_FORK',
			'ACP_WITH_MODEL_REFERENCE',
			'INVALID_ACP',
		]),
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

export class SessionModelError extends Schema.TaggedError<SessionModelError>()(
	'SessionModelError',
	{
		sessionId: Schema.String,
		code: Schema.Literals(['UNSUPPORTED_BACKEND', 'INVALID_MODEL']),
		message: Schema.String,
	},
) {}

export class SessionJobNotFound extends Schema.TaggedError<SessionJobNotFound>()(
	'SessionJobNotFound',
	{ sessionId: Schema.String, jobId: Schema.String },
) {
	override get message() {
		return `Job ${this.jobId} is not a turn of session ${this.sessionId}`;
	}
}

export class InvalidHistoryQuery extends Schema.TaggedError<InvalidHistoryQuery>()(
	'InvalidHistoryQuery',
	{ message: Schema.String },
) {}

export type HistoryTurn = {
	jobId: string;
	/** 1-based position among the session's root jobs. */
	number: number;
	status: JobRow['status'];
	prompt: string;
	text: string | null;
	errorMessage: string | null;
	toolCalls: Record<string, number>;
	createdAt: number;
};

type HistoryBase = {
	session: { id: string; title: string; status: 'running' | 'idle' };
	forkedFromJobId: string | null;
	total: number;
};

export type SessionHistory =
	| (HistoryBase & {
			view: 'turns';
			firstNumber: number;
			turns: HistoryTurn[];
			/** Pass as `before` to fetch the next older page; null when none. */
			before: string | null;
	  })
	| (HistoryBase & {
			view: 'turn';
			turn: HistoryTurn & { entries: TimelineEntry[] };
	  });

const withinDirectory = (column: AnySQLiteColumn, directory: string) =>
	sql`(${column} = ${directory} OR substr(${column}, 1, length(${directory}) + 1) = ${`${directory}/`})`;

// Matches sessions whose working or origin directory is `cwd` or inside it.
const cwdFilter = (cwd: string | undefined) => {
	if (cwd === undefined) return undefined;
	const directory = cwd.replace(/\/+$/, '');
	if (directory === '') return undefined;
	return or(
		withinDirectory(schema.sessions.cwd, directory),
		withinDirectory(schema.sessions.origin_cwd, directory),
	);
};

type StartInput = {
	title: string;
	prompt: string;
	cwd?: string;
	model?: string;
	agentType?: string;
	agent?: import('./agents.ts').AgentDefinition;
	forkId?: string;
	acp?: AcpCommand;
	worktree?: WorktreeRequest;
};

export class Sessions extends Context.Service<Sessions>()('oagent/Sessions', {
	make: Effect.gen(function* () {
		const dbService = yield* Db;
		const db = dbService.db;
		const jobs = yield* Jobs;
		const harnessRegistry = yield* HarnessRegistry;
		const worktrees = yield* Worktrees;

		const insertSession = (input: {
			title: string;
			backend: HarnessId;
			acpCommand?: AcpCommand;
			harnessSessionId?: string;
			cwd: string;
			originCwd: string;
			worktreePath?: string;
			worktreeBranch?: string;
			forkedFromJobId?: number;
		}) =>
			Effect.try({
				try: () =>
					db
						.insert(schema.sessions)
						.values({
							uuid: randomUUIDv7(),
							title: input.title,
							backend: input.backend,
							acp_command:
								input.acpCommand === undefined
									? undefined
									: {
											binary: input.acpCommand.binary,
											args: [...input.acpCommand.args],
										},
							harness_session_id: input.harnessSessionId,
							cwd: input.cwd,
							origin_cwd: input.originCwd,
							worktree_path: input.worktreePath,
							worktree_branch: input.worktreeBranch,
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
				.where(
					and(
						eq(schema.jobs.session_id, session.id),
						isNull(schema.jobs.side_chat_id),
					),
				)
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

		const forkHarnessSession = (forkId: string, modelOverride?: string) =>
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
						message: `Session ${source.session.uuid} has no turn to fork.`,
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
				if (selectedJob.model === null && modelOverride === undefined) {
					return yield* new SessionForkError({
						forkId,
						code: 'SOURCE_NOT_READY',
						message: `Job ${selectedJob.uuid} has no recorded model to inherit.`,
					});
				}

				const backend = source.session.backend;
				const harness = yield* harnessRegistry.resolveForSession(
					source.session,
				);
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
											code:
												error instanceof AcpForkNotSupportedError
													? 'FORK_NOT_SUPPORTED'
													: 'FORK_FAILED',
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
					reasoningEffort: selectedJob.reasoning_effort ?? undefined,
					agentType: selectedJob.agent_type ?? undefined,
					backend,
					acpCommand: source.session.acp_command ?? undefined,
					harnessSessionId: forkedSession.sessionId,
				};
			});

		const start = (input: StartInput) =>
			Effect.gen(function* () {
				if (input.agent !== undefined && input.agentType !== undefined) {
					return yield* new SessionStartError({
						code: 'CONFLICTING_AGENT',
						message: 'agent and agent_type are mutually exclusive',
					});
				}
				if (input.acp !== undefined) {
					if (input.forkId !== undefined) {
						return yield* new SessionStartError({
							code: 'ACP_WITH_FORK',
							message:
								'acp and forkId are mutually exclusive: forking an inline ACP session reuses its stored command.',
						});
					}
					if (input.acp.binary.trim().length === 0) {
						return yield* new SessionStartError({
							code: 'INVALID_ACP',
							message: 'acp.binary must not be empty.',
						});
					}
				}
				if (input.worktree !== undefined) yield* worktrees.ensureEnabled();
				const source =
					input.forkId === undefined ? undefined : findForkSource(input.forkId);
				const inlineSource = source?.session.backend === INLINE_ACP_HARNESS_ID;
				if (
					input.model !== undefined &&
					(input.acp !== undefined || inlineSource) &&
					(yield* jobs.hasHarnessPrefix(input.model))
				) {
					return yield* new SessionStartError({
						code: 'ACP_WITH_MODEL_REFERENCE',
						message: `Inline ACP sessions take the adapter's bare model id, but "${input.model}" starts with a harness prefix.`,
					});
				}
				const forkAgentTarget =
					source?.job !== undefined &&
					!inlineSource &&
					(input.model !== undefined || source.job.model !== null)
						? yield* jobs.validateStart({
								model:
									input.model ??
									`${source.session.backend}:${source.job.model}`,
								backend: source.session.backend,
								agentType:
									input.agent === undefined
										? (input.agentType ?? source.job.agent_type ?? undefined)
										: undefined,
								agent: input.agent,
								agentTarget:
									input.agent === undefined && input.agentType === undefined
										? (source.job.agent_target ?? undefined)
										: undefined,
							})
						: undefined;
				const fork =
					input.forkId === undefined
						? undefined
						: yield* forkHarnessSession(input.forkId, input.model);
				const backend =
					fork !== undefined
						? fork.backend
						: input.acp !== undefined
							? INLINE_ACP_HARNESS_ID
							: yield* jobs.resolveBackend(input.model);
				const acpCommand = input.acp ?? fork?.acpCommand;
				const cwd = input.cwd ?? fork?.sourceSession.cwd;
				if (cwd === undefined) {
					return yield* new SessionStartError({
						code: 'MISSING_CWD',
						message: 'cwd is required when starting a new session.',
					});
				}
				const model =
					input.model ??
					(fork === undefined || fork.model === null
						? undefined
						: sessionModelInput(fork.backend, fork.model));
				const agentType =
					input.agent === undefined
						? (input.agentType ?? fork?.agentType)
						: undefined;
				const agentTarget =
					fork === undefined &&
					model !== undefined &&
					backend !== INLINE_ACP_HARNESS_ID
						? yield* jobs.validateStart({
								model,
								backend,
								agentType,
								agent: input.agent,
							})
						: forkAgentTarget;
				const session = yield* insertSession({
					title: input.title,
					backend,
					acpCommand,
					harnessSessionId: fork?.harnessSessionId,
					cwd,
					originCwd:
						fork === undefined || input.cwd !== undefined
							? cwd
							: fork.sourceSession.origin_cwd,
					worktreePath: fork?.sourceSession.worktree_path ?? undefined,
					worktreeBranch: fork?.sourceSession.worktree_branch ?? undefined,
					forkedFromJobId: fork?.sourceJob.id,
				});
				const result = yield* jobs.start({
					session,
					prompt: input.prompt,
					model,
					reasoningEffort: fork?.reasoningEffort,
					agent: input.agent,
					agentTarget:
						input.agent !== undefined ||
						(input.agentType === undefined && source?.job?.agent_target != null)
							? agentTarget
							: undefined,
					agentType,
					worktree: input.worktree,
				});
				return { sessionId: session.uuid, ...result };
			});

		const setModel = (sessionId: string, model: string) =>
			Effect.gen(function* () {
				const session = yield* findSession(sessionId);
				if (!harnessRegistry.supportsModelSwitch(session.backend)) {
					return yield* new SessionModelError({
						sessionId,
						code: 'UNSUPPORTED_BACKEND',
						message: `The ${session.backend} backend does not support switching models on a session.`,
					});
				}
				const harness = yield* harnessRegistry.resolveForSession(session);
				const models = yield* harness.listModels();
				if (!models.some((entry) => entry.id === model)) {
					return yield* new SessionModelError({
						sessionId,
						code: 'INVALID_MODEL',
						message: `Model ${model} is not available for ${session.backend}.`,
					});
				}
				yield* Effect.try({
					try: () =>
						db
							.update(schema.sessions)
							.set({ model, reasoning_effort: null })
							.where(eq(schema.sessions.id, session.id))
							.run(),
					catch: (cause) =>
						new SessionPersistenceError({
							message: 'Could not persist the session model.',
							cause,
						}),
				});
				return { ok: true as const };
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
					const released = yield* jobs.releaseHold(running.uuid);
					const steered = released
						? false
						: yield* jobs.steer(running.uuid, input.prompt).pipe(
								Effect.as(true),
								Effect.catchTag('JobSteerError', (error) => {
									if (error.code === 'NOT_RUNNING')
										return Effect.succeed(false);
									const unsupported =
										error.code === 'UNSUPPORTED_BACKEND' ||
										error.code === 'UNSUPPORTED_VERSION';
									return Effect.fail(
										new SessionBusy({
											sessionId: session.uuid,
											code: unsupported
												? 'UNSUPPORTED_BACKEND'
												: 'TURN_IN_PROGRESS',
											message: unsupported
												? `Session ${session.uuid} is busy on the ${session.backend} backend, which cannot take messages mid-turn: ${error.message}`
												: error.message,
										}),
									);
								}),
							);
					if (steered) {
						return {
							sessionId: session.uuid,
							jobId: running.uuid,
							delivery: 'steered' as const,
						};
					}
					const completed = yield* jobs.wait({ jobId: running.uuid });
					if (completed.status === 'running') {
						return yield* new SessionBusy({
							sessionId: session.uuid,
							code: 'TURN_IN_PROGRESS',
							message: `Session ${session.uuid} is finishing its current turn.`,
						});
					}
				}

				const latest = latestJob(session);
				const model = session.model ?? latest?.model;
				// An inline session that never learned its model leaves the choice to the adapter.
				if (
					(model === undefined || model === null) &&
					session.backend !== INLINE_ACP_HARNESS_ID
				) {
					return yield* new SessionNotReady({
						sessionId: session.uuid,
						message: `Session ${session.uuid} has no prior turn from which to inherit a model.`,
					});
				}
				const result = yield* jobs
					.start({
						session,
						prompt: input.prompt,
						model:
							model === undefined || model === null
								? undefined
								: sessionModelInput(session.backend, model),
						reasoningEffort:
							(session.model !== null
								? session.reasoning_effort
								: latest?.reasoning_effort) ?? undefined,
						agentType: latest?.agent_type ?? undefined,
						agentTarget: latest?.agent_target ?? undefined,
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

		const result = (input: { sessionId: string; wait?: boolean }) =>
			Effect.gen(function* () {
				const session = yield* findSession(input.sessionId);
				const job = latestJob(session);
				if (job === undefined) {
					return yield* new SessionNotReady({
						sessionId: session.uuid,
						message: `Session ${session.uuid} has no jobs to get a result from.`,
					});
				}
				const turn = yield* jobs.wait({
					jobId: job.uuid,
					timeoutMs: input.wait === true ? undefined : 0,
				});
				return { ...turn, jobId: job.uuid };
			});

		const history = (input: {
			sessionId: string;
			jobId?: string;
			limit?: number;
			before?: string;
		}) =>
			Effect.gen(function* () {
				if (
					input.jobId !== undefined &&
					(input.limit !== undefined || input.before !== undefined)
				) {
					return yield* new InvalidHistoryQuery({
						message: 'jobId cannot be combined with limit or before.',
					});
				}
				const session = yield* findSession(input.sessionId);
				const rootJobs = db
					.select({
						id: schema.jobs.id,
						uuid: schema.jobs.uuid,
						status: schema.jobs.status,
					})
					.from(schema.jobs)
					.where(
						and(
							eq(schema.jobs.session_id, session.id),
							isNull(schema.jobs.side_chat_id),
						),
					)
					.orderBy(asc(schema.jobs.created_at), asc(schema.jobs.id))
					.all();
				const indexOfJob = (jobId: string) =>
					rootJobs.findIndex((job) => job.uuid === jobId);

				const forkSource =
					session.forked_from_job_id === null
						? undefined
						: db
								.select({ uuid: schema.jobs.uuid })
								.from(schema.jobs)
								.where(eq(schema.jobs.id, session.forked_from_job_id))
								.get();
				if (session.forked_from_job_id !== null && forkSource === undefined) {
					return yield* Effect.die(
						new Error(
							`Invariant violated: session ${session.uuid} forks missing job ${session.forked_from_job_id}`,
						),
					);
				}
				const base: HistoryBase = {
					session: {
						id: session.uuid,
						title: session.title,
						status:
							rootJobs[rootJobs.length - 1]?.status === 'running'
								? 'running'
								: 'idle',
					},
					forkedFromJobId: forkSource?.uuid ?? null,
					total: rootJobs.length,
				};

				const loadTurns = (
					firstPosition: number,
					selected: typeof rootJobs,
				): HistoryTurn[] => {
					const uuids = selected.map((job) => job.uuid);
					const rows = new Map(
						db
							.select()
							.from(schema.jobs)
							.where(inArray(schema.jobs.uuid, uuids))
							.all()
							.map((row) => [row.uuid, row]),
					);
					const counts = jobs.toolCallCountsByKind(uuids);
					return selected.map((job, index) => {
						const row = rows.get(job.uuid);
						const toolCalls = counts.get(job.uuid);
						if (row === undefined || toolCalls === undefined) {
							throw new Error(`Invariant violated: job ${job.uuid} unreadable`);
						}
						return {
							jobId: row.uuid,
							number: firstPosition + index + 1,
							status: row.status,
							prompt: row.prompt,
							text: row.text,
							errorMessage: row.error_message,
							toolCalls,
							createdAt: row.created_at.getTime(),
						};
					});
				};

				if (input.jobId !== undefined) {
					const position = indexOfJob(input.jobId);
					const job = rootJobs[position];
					const turn =
						job === undefined ? undefined : loadTurns(position, [job])[0];
					if (turn === undefined) {
						return yield* new SessionJobNotFound({
							sessionId: session.uuid,
							jobId: input.jobId,
						});
					}
					return {
						...base,
						view: 'turn' as const,
						turn: {
							...turn,
							entries: foldTimeline(jobs.readAllEvents(input.jobId)),
						},
					};
				}

				const end =
					input.before === undefined
						? rootJobs.length
						: indexOfJob(input.before);
				if (input.before !== undefined && end === -1) {
					return yield* new SessionJobNotFound({
						sessionId: session.uuid,
						jobId: input.before,
					});
				}
				const limit = input.limit ?? HISTORY_DEFAULT_LIMIT;
				const start = Math.max(0, end - limit);
				const selected = rootJobs.slice(start, end);
				const oldest = selected[0];
				return {
					...base,
					view: 'turns' as const,
					firstNumber: start + 1,
					turns: loadTurns(start, selected),
					before: start > 0 && oldest !== undefined ? oldest.uuid : null,
				};
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

		const list = (input: { cwd?: string }) =>
			Effect.sync(() => {
				const activity = db
					.select({
						sessionId: schema.jobs.session_id,
						lastActivityAt:
							sql<number>`max(coalesce(${schema.jobs.terminated_at}, ${schema.jobs.created_at}))`.as(
								'last_activity_at',
							),
					})
					.from(schema.jobs)
					.where(isNull(schema.jobs.side_chat_id))
					.groupBy(schema.jobs.session_id)
					.as('activity');
				const rows = db
					.select({
						...getTableColumns(schema.sessions),
						lastActivityAt: activity.lastActivityAt,
					})
					.from(schema.sessions)
					.innerJoin(activity, eq(activity.sessionId, schema.sessions.id))
					.where(cwdFilter(input.cwd))
					.orderBy(desc(activity.lastActivityAt), desc(schema.sessions.id))
					.limit(100)
					.all();
				const sessions: Array<{
					id: string;
					title: string;
					jobId: string;
					status: JobRow['status'];
					prompt: string;
					cwd: string;
					originCwd: string;
					worktreePath?: string;
					worktreeBranch?: string;
					backend: HarnessId;
					acpCommand?: AcpCommand;
					model?: string;
					agentType?: string;
					createdAt: number;
					lastActivityAt: number;
				}> = [];
				for (const session of rows) {
					const job = latestJob(session);
					if (job === undefined) continue;
					sessions.push({
						id: session.uuid,
						title: session.title,
						jobId: job.uuid,
						status: job.status,
						prompt: job.prompt,
						cwd: session.cwd,
						originCwd: session.origin_cwd,
						worktreePath: session.worktree_path ?? undefined,
						worktreeBranch: session.worktree_branch ?? undefined,
						backend: session.backend,
						acpCommand: session.acp_command ?? undefined,
						model: job.model ?? undefined,
						agentType: job.agent_type ?? undefined,
						createdAt: session.created_at.getTime(),
						lastActivityAt: session.lastActivityAt,
					});
				}
				return sessions;
			});

		const get = (input: { sessionId: string }) =>
			Effect.gen(function* () {
				const session = yield* findSession(input.sessionId);
				const rootJobs = jobs.listForSession(session.id);
				const last = rootJobs[rootJobs.length - 1];
				return {
					id: session.uuid,
					title: session.title,
					cwd: session.cwd,
					createdAt: session.created_at.getTime(),
					backend: session.backend,
					acpCommand: session.acp_command ?? undefined,
					model: session.model ?? last?.model,
					supportsModelSwitch: harnessRegistry.supportsModelSwitch(
						session.backend,
					),
					status: last?.status,
					jobs: rootJobs,
				};
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
					title: sourceSession.title,
					backend: sourceSession.backend,
					acpCommand: sourceSession.acp_command ?? undefined,
					cwd: sourceSession.cwd,
					originCwd: sourceSession.origin_cwd,
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
			setModel,
			sendMessage,
			result,
			history,
			cancel,
			list,
			get,
			createSideChatSession,
			findSideChatSession,
		};
	}),
}) {
	static readonly layer = Layer.effect(Sessions, Sessions.make).pipe(
		Layer.provide(Jobs.layer),
		Layer.provide(HarnessRegistry.layer),
		Layer.provide(Db.layer),
		Layer.provide(Worktrees.layer),
	);
}
