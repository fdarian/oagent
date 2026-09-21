/// <reference types="bun" />

import { EventEmitter } from 'node:events';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { randomUUIDv7 } from 'bun';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { Context, Effect, Fiber, Layer, Schema } from 'effect';
import {
	type AgentNotMappedForBackend,
	Agents,
	type AgentTypeNotFound,
} from './agents.ts';
import { assembleEvent } from './db/assembleEvent.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { EVENT_DEDUPE_META_KEY, eventDedupeKey } from './event-key.ts';
import { type Backend, isBackend, parseBackend } from './harness.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { Settings } from './settings.ts';

export class JobNotFound extends Schema.TaggedError<JobNotFound>()(
	'JobNotFound',
	{
		jobId: Schema.String,
	},
) {
	override get message() {
		return `Job not found: ${this.jobId}`;
	}
}

export class JobSteerError extends Schema.TaggedError<JobSteerError>()(
	'JobSteerError',
	{
		code: Schema.Literals([
			'NOT_RUNNING',
			'UNSUPPORTED_BACKEND',
			'UNSUPPORTED_VERSION',
			'VERSION_CHECK_FAILED',
			'SESSION_NOT_READY',
			'DELIVERY_FAILED',
		]),
		message: Schema.String,
	},
) {}

export class ModelResolutionError extends Schema.TaggedError<ModelResolutionError>()(
	'ModelResolutionError',
	{
		code: Schema.Literals([
			'MISSING',
			'INVALID_FORMAT',
			'UNKNOWN_BACKEND',
			'UNKNOWN_ALIAS',
		]),
		message: Schema.String,
	},
) {}

export class JobStartError extends Schema.TaggedError<JobStartError>()(
	'JobStartError',
	{
		code: Schema.Literals(['SIDE_CHAT_TURN_IN_PROGRESS', 'PERSISTENCE_FAILED']),
		message: Schema.String,
		cause: Schema.Defect(),
	},
) {}

type JobOk = {
	readonly sessionId: string;
	readonly text: string;
	readonly stopReason: string | undefined;
};

type JobReservation = {
	readonly internalId: number;
	readonly jobId: string;
	readonly prompt: string;
	readonly cwd: string;
	readonly backend: Backend;
	readonly model: string;
	readonly reasoningEffort: string | undefined;
	readonly agentTarget: string | undefined;
	readonly sessionId: string | undefined;
};

type ReserveJobInput = {
	prompt: string;
	model?: string;
	agentType?: string;
	sessionId?: string;
	mcpSessionId?: string;
	sideChatId?: number;
	cwd: string;
};

type WaitResult =
	| { readonly status: 'running' }
	| {
			readonly status: 'done';
			readonly sessionId: string;
			readonly text: string;
			readonly stopReason: string | undefined;
	  }
	| {
			readonly status: 'error';
			readonly message: string;
			readonly sessionId?: string;
	  }
	| { readonly status: 'cancelled'; readonly sessionId?: string };

type EventPage = {
	events: { event: SessionUpdate; sequence: number; createdAt: number }[];
	nextCursor: number | null;
};

type JobsChange = {
	type: 'created' | 'status' | 'updated';
	jobId: string;
	status?: string;
};

const TIMEOUT_DEFAULT_MS = 50_000;

export const DEFAULT_START_TIMEOUT_MS = 30 * 60 * 1000;

/** Sentinel event type emitted to SSE subscribers when a job reaches terminal status. */
const TERMINAL_EVENT = '__terminal__';

function isRunningSideChatTurnConflict(cause: unknown): boolean {
	if (cause === null || typeof cause !== 'object' || !('message' in cause)) {
		return false;
	}
	if (typeof cause.message !== 'string') return false;
	return (
		cause.message.includes('UNIQUE constraint failed') &&
		(cause.message.includes('jobs.side_chat_id') ||
			cause.message.includes('jobs_side_chat_running_uq'))
	);
}

export class Jobs extends Context.Service<Jobs>()('oagent/Jobs', {
	make: Effect.gen(function* () {
		const harnessRegistry = yield* HarnessRegistry;
		const settings = yield* Settings;
		const agents = yield* Agents;
		const dbService = yield* Db;
		const db = dbService.db;

		const resolveModel = (
			model: string,
		): Effect.Effect<
			{
				backend: Backend;
				modelId: string;
				reasoningEffort: string | undefined;
			},
			ModelResolutionError,
			never
		> =>
			Effect.gen(function* () {
				const colonIdx = model.indexOf(':');
				if (colonIdx !== -1) {
					const backend = model.slice(0, colonIdx);
					const modelId = model.slice(colonIdx + 1);
					if (!isBackend(backend)) {
						return yield* new ModelResolutionError({
							code: 'UNKNOWN_BACKEND',
							message: `Unknown backend "${backend}". Valid backends: opencode, cursor, grok, codex, claude.`,
						});
					}
					return { backend, modelId, reasoningEffort: undefined };
				}

				const alias = db
					.select()
					.from(schema.modelAliases)
					.where(eq(schema.modelAliases.name, model))
					.limit(1)
					.get();

				if (alias === undefined) {
					return yield* new ModelResolutionError({
						code: 'UNKNOWN_ALIAS',
						message: `Model "${model}" is not a defined alias. Pass <backend>:<modelId> or define an alias first.`,
					});
				}
				if (!isBackend(alias.backend)) {
					return yield* new ModelResolutionError({
						code: 'UNKNOWN_BACKEND',
						message: `Model alias "${model}" references unknown backend "${alias.backend}".`,
					});
				}

				return {
					backend: alias.backend,
					modelId: alias.model_id,
					reasoningEffort: alias.reasoning_effort ?? undefined,
				};
			});

		const liveEmitters = new Map<string, EventEmitter>();
		const liveFibers = new Map<string, Fiber.Fiber<JobOk, unknown>>();
		const jobsEmitter = new EventEmitter();
		jobsEmitter.setMaxListeners(0);

		const insertEvent = (
			jobId: number,
			event: SessionUpdate,
		): { id: number; inserted: boolean } => {
			return db.transaction((tx) => {
				const sourceMeta =
					'_meta' in event && event._meta !== undefined && event._meta !== null
						? (event._meta as Record<string, unknown>)
						: null;
				const key = eventDedupeKey(event);
				const existing = tx
					.select({ id: schema.events.id, meta: schema.events.meta })
					.from(schema.events)
					.where(eq(schema.events.job_id, jobId))
					.all()
					.find((row) => row.meta?.[EVENT_DEDUPE_META_KEY] === key);
				if (existing !== undefined) {
					return { id: existing.id, inserted: false };
				}
				const meta = {
					...(sourceMeta ?? {}),
					[EVENT_DEDUPE_META_KEY]: key,
				};

				const eventRow = tx
					.insert(schema.events)
					.values({
						job_id: jobId,
						type: event.sessionUpdate,
						meta,
					})
					.returning({ id: schema.events.id })
					.get();
				if (eventRow === undefined) {
					throw new Error('Failed to insert event');
				}
				const eventId = eventRow.id;

				switch (event.sessionUpdate) {
					case 'user_message_chunk':
					case 'agent_message_chunk':
					case 'agent_thought_chunk': {
						tx.insert(schema.chunkEvents)
							.values({
								event_id: eventId,
								message_id: event.messageId ?? null,
								content: event.content,
							})
							.run();
						break;
					}
					case 'tool_call':
					case 'tool_call_update': {
						tx.insert(schema.toolCallEvents)
							.values({
								event_id: eventId,
								tool_call_id: event.toolCallId,
								title: event.title ?? null,
								status: event.status ?? null,
								kind: event.kind ?? null,
								content: event.content ?? null,
								locations: event.locations ?? null,
								raw_input: event.rawInput ?? null,
								raw_output: event.rawOutput ?? null,
							})
							.run();
						break;
					}
					case 'plan': {
						tx.insert(schema.planEvents)
							.values({
								event_id: eventId,
								entries: event.entries,
							})
							.run();
						break;
					}
					case 'available_commands_update': {
						tx.insert(schema.availableCommandsEvents)
							.values({
								event_id: eventId,
								available_commands: event.availableCommands,
							})
							.run();
						break;
					}
					case 'current_mode_update': {
						tx.insert(schema.currentModeEvents)
							.values({
								event_id: eventId,
								current_mode_id: event.currentModeId,
							})
							.run();
						break;
					}
					case 'config_option_update': {
						tx.insert(schema.configOptionEvents)
							.values({
								event_id: eventId,
								config_options: event.configOptions,
							})
							.run();
						break;
					}
					case 'session_info_update': {
						tx.insert(schema.sessionInfoEvents)
							.values({
								event_id: eventId,
								title: event.title ?? null,
								updated_at: event.updatedAt ?? null,
							})
							.run();
						break;
					}
					case 'usage_update': {
						tx.insert(schema.usageEvents)
							.values({
								event_id: eventId,
								size: event.size,
								used: event.used,
								cost_amount: event.cost?.amount ?? null,
								cost_currency: event.cost?.currency ?? null,
							})
							.run();
						break;
					}
				}

				return { id: eventId, inserted: true };
			});
		};

		const publishEvent = (
			internalJobId: number,
			jobId: string,
			event: SessionUpdate,
		): void => {
			const inserted = insertEvent(internalJobId, event);
			if (!inserted.inserted) return;
			const emitter = liveEmitters.get(jobId);
			if (emitter !== undefined) {
				emitter.emit('event', { event, sequence: inserted.id });
			}
		};

		const readEventsPage = (
			jobId: number,
			sinceId: number,
			limit: number,
		): EventPage => {
			const rows = db
				.select()
				.from(schema.events)
				.leftJoin(
					schema.chunkEvents,
					eq(schema.events.id, schema.chunkEvents.event_id),
				)
				.leftJoin(
					schema.toolCallEvents,
					eq(schema.events.id, schema.toolCallEvents.event_id),
				)
				.leftJoin(
					schema.planEvents,
					eq(schema.events.id, schema.planEvents.event_id),
				)
				.leftJoin(
					schema.availableCommandsEvents,
					eq(schema.events.id, schema.availableCommandsEvents.event_id),
				)
				.leftJoin(
					schema.currentModeEvents,
					eq(schema.events.id, schema.currentModeEvents.event_id),
				)
				.leftJoin(
					schema.configOptionEvents,
					eq(schema.events.id, schema.configOptionEvents.event_id),
				)
				.leftJoin(
					schema.sessionInfoEvents,
					eq(schema.events.id, schema.sessionInfoEvents.event_id),
				)
				.leftJoin(
					schema.usageEvents,
					eq(schema.events.id, schema.usageEvents.event_id),
				)
				.where(
					and(eq(schema.events.job_id, jobId), gt(schema.events.id, sinceId)),
				)
				.orderBy(schema.events.created_at, schema.events.id)
				.limit(limit + 1)
				.all();

			const hasMore = rows.length === limit + 1;
			const pageRows = hasMore ? rows.slice(0, limit) : rows;

			const events = pageRows.map((row) => {
				const event = assembleEvent(
					{
						id: row.events.id,
						job_id: row.events.job_id,
						created_at: row.events.created_at,
						type: row.events.type,
						meta: row.events.meta,
					},
					{
						message_id: row.chunk_events?.message_id ?? null,
						content: row.chunk_events?.content ?? null,
						tool_call_id: row.tool_call_events?.tool_call_id ?? null,
						tool_content: row.tool_call_events?.content ?? null,
						title: row.tool_call_events?.title ?? null,
						status: row.tool_call_events?.status ?? null,
						kind: row.tool_call_events?.kind ?? null,
						locations: row.tool_call_events?.locations ?? null,
						raw_input: row.tool_call_events?.raw_input ?? null,
						raw_output: row.tool_call_events?.raw_output ?? null,
						entries: row.plan_events?.entries ?? null,
						available_commands:
							row.available_commands_events?.available_commands ?? null,
						current_mode_id: row.current_mode_events?.current_mode_id ?? null,
						config_options: row.config_option_events?.config_options ?? null,
						updated_at: row.session_info_events?.updated_at ?? null,
						size: row.usage_events?.size ?? null,
						used: row.usage_events?.used ?? null,
						cost_amount: row.usage_events?.cost_amount ?? null,
						cost_currency: row.usage_events?.cost_currency ?? null,
					},
				);
				return {
					event,
					sequence: row.events.id,
					createdAt: row.events.created_at.getTime(),
				};
			});

			const nextCursor = (() => {
				if (!hasMore) return null;
				const last = pageRows[pageRows.length - 1];
				if (last === undefined) return null;
				return last.events.id;
			})();

			return { events, nextCursor };
		};

		const reserve = (
			input: ReserveJobInput,
		): Effect.Effect<
			JobReservation,
			| ModelResolutionError
			| AgentTypeNotFound
			| AgentNotMappedForBackend
			| JobStartError,
			never
		> =>
			Effect.gen(function* () {
				const model = input.model;
				if (model === undefined) {
					return yield* new ModelResolutionError({
						code: 'MISSING',
						message:
							'model is required: specify `<backend>:<modelId>` or an alias name',
					});
				}

				const resolvedModel = yield* resolveModel(model);
				const backend = resolvedModel.backend;
				const rest = resolvedModel.modelId;
				const reasoningEffort = resolvedModel.reasoningEffort;
				const agentTarget =
					input.agentType === undefined
						? undefined
						: yield* agents.resolve(input.agentType, backend);
				const uuid = randomUUIDv7();

				const jobRow = yield* Effect.try({
					try: () =>
						db.transaction((tx) =>
							tx
								.insert(schema.jobs)
								.values({
									uuid,
									status: 'running',
									prompt: input.prompt,
									cwd: input.cwd,
									model: rest,
									agent_type: input.agentType,
									backend,
									session_id: input.sessionId,
									mcp_session_id: input.mcpSessionId,
									side_chat_id: input.sideChatId,
								})
								.returning({ id: schema.jobs.id })
								.get(),
						),
					catch: (cause) =>
						input.sideChatId !== undefined &&
						isRunningSideChatTurnConflict(cause)
							? new JobStartError({
									code: 'SIDE_CHAT_TURN_IN_PROGRESS',
									message: 'This side chat already has a turn in progress.',
									cause,
								})
							: new JobStartError({
									code: 'PERSISTENCE_FAILED',
									message: 'Could not persist the job.',
									cause,
								}),
				});
				if (jobRow === undefined) {
					return yield* new JobStartError({
						code: 'PERSISTENCE_FAILED',
						message: 'Could not persist the job.',
						cause: new Error('Job insert returned no row'),
					});
				}
				const internalId = jobRow.id;
				jobsEmitter.emit('change', { type: 'created', jobId: uuid });
				return {
					internalId,
					jobId: uuid,
					prompt: input.prompt,
					cwd: input.cwd,
					backend,
					model: rest,
					reasoningEffort,
					agentTarget,
					sessionId: input.sessionId,
				};
			});

		const failReserved = (
			reservation: JobReservation,
			error: unknown,
		): Effect.Effect<void, JobStartError, never> =>
			Effect.try({
				try: () => {
					const failed = db
						.update(schema.jobs)
						.set({
							status: 'error',
							error_message: formatJobError(error),
							terminated_at: new Date(),
						})
						.where(
							and(
								eq(schema.jobs.id, reservation.internalId),
								eq(schema.jobs.status, 'running'),
							),
						)
						.returning({ id: schema.jobs.id })
						.get();
					if (failed !== undefined) {
						jobsEmitter.emit('change', {
							type: 'status',
							jobId: reservation.jobId,
							status: 'error',
						});
					}
				},
				catch: (cause) =>
					new JobStartError({
						code: 'PERSISTENCE_FAILED',
						message: 'Could not record the job failure.',
						cause,
					}),
			});

		const runReserved = (input: {
			reservation: JobReservation;
			agentPrompt?: string;
			sessionId?: string;
			onPromptDispatch?: () => void;
		}): Effect.Effect<{ jobId: string }, JobStartError, never> => {
			const sessionId =
				input.sessionId === undefined
					? input.reservation.sessionId
					: input.sessionId;
			const agentPrompt =
				input.agentPrompt === undefined
					? input.reservation.prompt
					: input.agentPrompt;

			return Effect.gen(function* () {
				if (
					sessionId !== undefined &&
					sessionId !== input.reservation.sessionId
				) {
					yield* Effect.try({
						try: () =>
							db
								.update(schema.jobs)
								.set({ session_id: sessionId })
								.where(
									and(
										eq(schema.jobs.id, input.reservation.internalId),
										eq(schema.jobs.status, 'running'),
									),
								)
								.returning({ id: schema.jobs.id })
								.get(),
						catch: (cause) =>
							new JobStartError({
								code: 'PERSISTENCE_FAILED',
								message: 'Could not prepare the reserved job.',
								cause,
							}),
					}).pipe(
						Effect.flatMap((updated) =>
							updated === undefined
								? new JobStartError({
										code: 'PERSISTENCE_FAILED',
										message: 'Reserved job is no longer running.',
										cause: new Error('Reserved job is no longer running'),
									})
								: Effect.void,
						),
					);
				}

				const emitter = new EventEmitter();
				emitter.setMaxListeners(0);
				liveEmitters.set(input.reservation.jobId, emitter);

				const onEvent = (event: SessionUpdate): void => {
					publishEvent(
						input.reservation.internalId,
						input.reservation.jobId,
						event,
					);
				};

				const closeResources = Effect.sync(() => {
					liveEmitters.delete(input.reservation.jobId);
					liveFibers.delete(input.reservation.jobId);
					emitter.emit(TERMINAL_EVENT);
				});

				const onSessionId = (sessionId: string): void => {
					db.update(schema.jobs)
						.set({ session_id: sessionId })
						.where(eq(schema.jobs.id, input.reservation.internalId))
						.run();
					jobsEmitter.emit('change', {
						type: 'updated',
						jobId: input.reservation.jobId,
					});
				};

				const runTurnEffect = harnessRegistry
					.get(input.reservation.backend)
					.runTurn({
						prompt: agentPrompt,
						model: input.reservation.model,
						reasoningEffort: input.reservation.reasoningEffort,
						mode: input.reservation.agentTarget,
						sessionId,
						cwd: input.reservation.cwd,
						onSessionId,
						onEvent,
						onPromptDispatch: input.onPromptDispatch,
					});

				const fiber = yield* Effect.forkDetach(
					runTurnEffect.pipe(
						Effect.tap((result) =>
							Effect.try({
								try: () => {
									const completed = db
										.update(schema.jobs)
										.set({
											status: 'done',
											session_id: result.sessionId,
											text: result.text,
											stop_reason: result.stopReason ?? null,
											terminated_at: new Date(),
										})
										.where(
											and(
												eq(schema.jobs.id, input.reservation.internalId),
												eq(schema.jobs.status, 'running'),
											),
										)
										.returning({ id: schema.jobs.id })
										.get();
									if (completed !== undefined) {
										jobsEmitter.emit('change', {
											type: 'status',
											jobId: input.reservation.jobId,
											status: 'done',
										});
									}
								},
								catch: (cause) =>
									new JobStartError({
										code: 'PERSISTENCE_FAILED',
										message: 'Could not record the completed job.',
										cause,
									}),
							}),
						),
						Effect.tapError((error) => failReserved(input.reservation, error)),
						Effect.ensuring(closeResources),
					),
					// The handoff can be masked, but the detached turn must stay interruptible.
					{ uninterruptible: false },
				);

				liveFibers.set(input.reservation.jobId, fiber);
				return { jobId: input.reservation.jobId };
			}).pipe(
				Effect.catch((error) =>
					failReserved(input.reservation, error).pipe(
						Effect.flatMap(() => error),
					),
				),
			);
		};

		const start = (
			input: ReserveJobInput & {
				agentPrompt?: string;
				onPromptDispatch?: () => void;
			},
		): Effect.Effect<
			{ jobId: string },
			| ModelResolutionError
			| AgentTypeNotFound
			| AgentNotMappedForBackend
			| JobStartError,
			never
		> =>
			Effect.gen(function* () {
				const reservation = yield* reserve(input);
				return yield* runReserved({
					reservation,
					agentPrompt: input.agentPrompt,
					onPromptDispatch: input.onPromptDispatch,
				});
			});

		const cancel = (input: {
			jobId: string;
		}): Effect.Effect<void, JobNotFound, never> =>
			Effect.gen(function* () {
				const job = db
					.select()
					.from(schema.jobs)
					.where(eq(schema.jobs.uuid, input.jobId))
					.limit(1)
					.get();

				if (job === undefined) {
					return yield* Effect.fail(new JobNotFound({ jobId: input.jobId }));
				}

				if (job.status !== 'running') {
					return;
				}

				db.update(schema.jobs)
					.set({ status: 'cancelled', terminated_at: new Date() })
					.where(eq(schema.jobs.id, job.id))
					.run();
				jobsEmitter.emit('change', {
					type: 'status',
					jobId: input.jobId,
					status: 'cancelled',
				});

				const fiber = liveFibers.get(input.jobId);
				if (fiber !== undefined) {
					yield* Fiber.interrupt(fiber);
				}
			});

		const steer = (
			jobId: string,
			text: string,
		): Effect.Effect<void, JobNotFound | JobSteerError, never> =>
			Effect.gen(function* () {
				const job = db
					.select()
					.from(schema.jobs)
					.where(eq(schema.jobs.uuid, jobId))
					.limit(1)
					.get();

				if (job === undefined) {
					return yield* new JobNotFound({ jobId });
				}

				if (job.status !== 'running') {
					return yield* new JobSteerError({
						code: 'NOT_RUNNING',
						message: `Job ${jobId} cannot be steered because it is ${job.status}; only running jobs can be steered.`,
					});
				}

				const backend = parseBackend(job.backend);
				const harness = harnessRegistry.get(backend);
				const steer = harness.steer;
				if (steer === undefined) {
					return yield* new JobSteerError({
						code: 'UNSUPPORTED_BACKEND',
						message: `Steering is not supported for backend "${backend}".`,
					});
				}

				if (job.session_id === null) {
					return yield* new JobSteerError({
						code: 'SESSION_NOT_READY',
						message: `Job ${jobId} cannot be steered yet because its OpenCode session ID has not been recorded. Try again after the session starts.`,
					});
				}

				const result = yield* steer({ sessionId: job.session_id, text }).pipe(
					Effect.mapError(
						(error) =>
							new JobSteerError({
								code: error.code,
								message: error.message,
							}),
					),
				);

				publishEvent(job.id, jobId, {
					sessionUpdate: 'user_message_chunk',
					messageId: result.messageId,
					content: { type: 'text', text: result.text },
					_meta: { 'oagent/steer': true },
				});
			});

		const wait = (input: {
			jobId: string;
			timeoutMs?: number;
		}): Effect.Effect<WaitResult, JobNotFound, never> =>
			Effect.gen(function* () {
				const job = db
					.select()
					.from(schema.jobs)
					.where(eq(schema.jobs.uuid, input.jobId))
					.limit(1)
					.get();

				if (job === undefined) {
					return yield* Effect.fail(new JobNotFound({ jobId: input.jobId }));
				}

				if (job.status !== 'running') {
					return toWaitResult(job);
				}

				const cap = input.timeoutMs ?? TIMEOUT_DEFAULT_MS;
				const fiber = liveFibers.get(input.jobId);

				if (fiber !== undefined) {
					yield* Fiber.join(fiber).pipe(Effect.exit, Effect.timeoutOption(cap));

					const updated = db
						.select()
						.from(schema.jobs)
						.where(eq(schema.jobs.uuid, input.jobId))
						.limit(1)
						.get();
					if (updated === undefined) {
						return yield* Effect.fail(new JobNotFound({ jobId: input.jobId }));
					}
					return toWaitResult(updated);
				}

				// Defensive fallback: poll the row at 500ms cadence
				const startTime = Date.now();
				const deadline = startTime + cap;
				while (Date.now() < deadline) {
					const row = db
						.select()
						.from(schema.jobs)
						.where(eq(schema.jobs.uuid, input.jobId))
						.limit(1)
						.get();
					if (row === undefined) {
						return yield* Effect.fail(new JobNotFound({ jobId: input.jobId }));
					}
					if (row.status !== 'running') {
						return toWaitResult(row);
					}
					Bun.sleepSync(500);
				}
				return { status: 'running' };
			});

		type JobSummary = {
			id: string;
			status: 'running' | 'done' | 'error' | 'cancelled';
			createdAt: number;
			terminatedAt?: number;
			prompt: string;
			cwd: string;
			backend: Backend;
			model?: string;
			agentType?: string;
			sessionId?: string;
			mcpSessionId?: string;
		};

		const toJobSummary = (
			row: typeof schema.jobs.$inferSelect,
		): JobSummary => ({
			id: row.uuid,
			status: row.status,
			createdAt: row.created_at.getTime(),
			terminatedAt: row.terminated_at?.getTime(),
			prompt: row.prompt,
			cwd: row.cwd,
			backend: parseBackend(row.backend),
			model: row.model ?? undefined,
			agentType: row.agent_type ?? undefined,
			sessionId: row.session_id === null ? undefined : row.session_id,
			mcpSessionId: row.mcp_session_id ?? undefined,
		});

		const list = (): JobSummary[] => {
			const rows = db
				.select()
				.from(schema.jobs)
				.where(isNull(schema.jobs.side_chat_id))
				.orderBy(
					sql`(${schema.jobs.status} = 'running') DESC`,
					desc(schema.jobs.created_at),
				)
				.all();

			return rows.map(toJobSummary);
		};

		const listByMcpSession = (mcpSessionId: string): JobSummary[] => {
			const rows = db
				.select()
				.from(schema.jobs)
				.where(
					and(
						eq(schema.jobs.mcp_session_id, mcpSessionId),
						isNull(schema.jobs.side_chat_id),
					),
				)
				.orderBy(
					sql`(${schema.jobs.status} = 'running') DESC`,
					desc(schema.jobs.created_at),
				)
				.all();

			return rows.map(toJobSummary);
		};

		const getJobMetadata = (jobId: string): JobSummary | undefined => {
			const job = db
				.select()
				.from(schema.jobs)
				.where(eq(schema.jobs.uuid, jobId))
				.limit(1)
				.get();
			if (job === undefined) return undefined;

			return toJobSummary(job);
		};

		const getRootJobMetadata = (jobId: string): JobSummary | undefined => {
			const job = db
				.select()
				.from(schema.jobs)
				.where(
					and(eq(schema.jobs.uuid, jobId), isNull(schema.jobs.side_chat_id)),
				)
				.limit(1)
				.get();
			if (job === undefined) return undefined;

			return toJobSummary(job);
		};

		const subscribe = (
			jobId: string,
			listener: (
				payload:
					| { type: 'event'; event: SessionUpdate; sequence: number }
					| { type: 'terminal' },
			) => void,
		): (() => void) => {
			const emitter = liveEmitters.get(jobId);
			if (emitter === undefined) {
				return () => {};
			}

			const onEvent = (payload: { event: SessionUpdate; sequence: number }) =>
				listener({
					type: 'event',
					event: payload.event,
					sequence: payload.sequence,
				});
			const onTerminal = () => listener({ type: 'terminal' });

			emitter.on('event', onEvent);
			emitter.once(TERMINAL_EVENT, onTerminal);

			return () => {
				emitter.off('event', onEvent);
				emitter.off(TERMINAL_EVENT, onTerminal);
			};
		};

		const subscribeJobs = (
			listener: (change: JobsChange) => void,
		): (() => void) => {
			jobsEmitter.on('change', listener);
			return () => {
				jobsEmitter.off('change', listener);
			};
		};

		const listAliases = () => {
			return db
				.select()
				.from(schema.modelAliases)
				.orderBy(schema.modelAliases.name)
				.all();
		};

		const saveAlias = (input: {
			name: string;
			backend: string;
			model_id: string;
			reasoning_effort?: string | null;
			description?: string | null;
		}) => {
			const now = new Date();
			db.insert(schema.modelAliases)
				.values({
					name: input.name,
					backend: input.backend,
					model_id: input.model_id,
					reasoning_effort: input.reasoning_effort ?? null,
					description: input.description ?? null,
					created_at: now,
					updated_at: now,
				})
				.onConflictDoUpdate({
					target: schema.modelAliases.name,
					set: {
						backend: input.backend,
						model_id: input.model_id,
						reasoning_effort: input.reasoning_effort ?? null,
						description: input.description ?? null,
						updated_at: now,
					},
				})
				.run();
			return {
				name: input.name,
				backend: input.backend,
				model_id: input.model_id,
				reasoning_effort: input.reasoning_effort ?? undefined,
				description: input.description ?? undefined,
			};
		};

		const deleteAlias = (name: string): boolean => {
			const existing = db
				.select()
				.from(schema.modelAliases)
				.where(eq(schema.modelAliases.name, name))
				.limit(1)
				.get();
			if (existing === undefined) {
				return false;
			}
			db.delete(schema.modelAliases)
				.where(eq(schema.modelAliases.name, name))
				.run();
			return true;
		};

		/**
		 * Max time the start tool blocks waiting for a job before returning a running handle.
		 *
		 * Safe because Claude Code's MCP tool-call timeout defaults to ~27.7h (1e8 ms): from
		 * the client binary, the per-call limit resolves as `.mcp.json` timeout → MCP_TOOL_TIMEOUT
		 * env → 1e8 ms default, floored at 1s, ceiled at INT32_MAX (~24.8 days). The server can NOT
		 * read that value — Claude Code injects no timeout into the MCP subprocess env (only
		 * CLAUDE_PROJECT_DIR) — and progress notifications do NOT extend it (hard wall-clock). So we
		 * pick our own conservative cap well under the default and hand back a {status:"running"}
		 * resume handle if it elapses, rather than trying to detect the client's limit.
		 */
		const getStartTimeoutMs = (): number => {
			const raw = settings.getSetting('start_timeout_ms');
			if (raw === undefined) {
				return DEFAULT_START_TIMEOUT_MS;
			}
			const parsed = Number.parseInt(raw, 10);
			if (Number.isNaN(parsed)) {
				throw new Error(`Corrupt start_timeout_ms setting: ${raw}`);
			}
			return parsed;
		};

		return {
			start,
			reserve,
			runReserved,
			failReserved,
			cancel,
			steer,
			wait,
			list,
			listByMcpSession,
			getJobMetadata,
			getRootJobMetadata,
			subscribe,
			subscribeJobs,
			listAliases,
			saveAlias,
			deleteAlias,
			getStartTimeoutMs,
			readEventsPage: (jobId: string, sinceId: number, limit: number) => {
				const job = db
					.select()
					.from(schema.jobs)
					.where(eq(schema.jobs.uuid, jobId))
					.limit(1)
					.get();
				if (job === undefined) return { events: [], nextCursor: null };
				return readEventsPage(job.id, sinceId, limit);
			},
		};
	}),
}) {
	static readonly layer = Layer.effect(Jobs, Jobs.make).pipe(
		Layer.provide(HarnessRegistry.layer),
		Layer.provide(Settings.layer),
		Layer.provide(Agents.layer),
		Layer.provide(Db.layer),
	);
}

function toWaitResult(job: {
	uuid: string;
	status: 'running' | 'done' | 'error' | 'cancelled';
	session_id: string | null;
	text: string | null;
	stop_reason: string | null;
	error_message: string | null;
}): WaitResult {
	if (job.status === 'running') return { status: 'running' };
	if (job.status === 'cancelled') {
		if (job.session_id === null) return { status: 'cancelled' };
		return { status: 'cancelled', sessionId: job.session_id };
	}
	if (job.status === 'done') {
		if (job.session_id === null || job.text === null) {
			throw new Error(
				`Invariant violated: done job ${job.uuid} missing session_id or text`,
			);
		}
		return {
			status: 'done',
			sessionId: job.session_id,
			text: job.text,
			stopReason: job.stop_reason ?? undefined,
		};
	}
	if (job.error_message === null) {
		throw new Error(
			`Invariant violated: error job ${job.uuid} missing error_message`,
		);
	}
	if (job.session_id === null) {
		return { status: 'error', message: job.error_message };
	}
	return {
		status: 'error',
		message: job.error_message,
		sessionId: job.session_id,
	};
}

function formatJobError(error: unknown): string {
	if (error !== null && typeof error === 'object') {
		const tag =
			'_tag' in error && typeof error._tag === 'string' ? error._tag : 'Error';
		const message =
			'message' in error && typeof error.message === 'string'
				? error.message
				: String(error);
		const code =
			'code' in error && typeof error.code === 'string'
				? `(${error.code})`
				: '';
		return `${tag}${code}: ${message}`;
	}
	return String(error);
}
