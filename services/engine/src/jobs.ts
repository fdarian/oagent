/// <reference types="bun" />

import { EventEmitter } from 'node:events';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { randomUUIDv7 } from 'bun';
import { desc, eq, sql } from 'drizzle-orm';
import { Effect, Fiber, Schema } from 'effect';
import { Cursor } from './cursor.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import {
	insertSessionUpdate,
	readSessionEventsPage,
} from './db/session-events.ts';
import { Grok } from './grok.ts';
import { OpenCode } from './opencode.ts';

class JobNotFound extends Schema.TaggedError<JobNotFound>()('JobNotFound', {
	jobId: Schema.String,
}) {}

export class ModelResolutionError extends Schema.TaggedError<ModelResolutionError>()(
	'ModelResolutionError',
	{
		code: Schema.Literal(
			'MISSING',
			'INVALID_FORMAT',
			'UNKNOWN_BACKEND',
			'UNKNOWN_ALIAS',
		),
		message: Schema.String,
	},
) {}

type JobOk = {
	readonly sessionId: string;
	readonly text: string;
	readonly stopReason: string | undefined;
};

type WaitResult =
	| { readonly status: 'running' }
	| {
			readonly status: 'done';
			readonly sessionId: string;
			readonly text: string;
			readonly stopReason: string | undefined;
	  }
	| { readonly status: 'error'; readonly message: string }
	| { readonly status: 'cancelled' };

type JobsChange = {
	type: 'created' | 'status';
	jobId: string;
	status?: string;
};

const TIMEOUT_DEFAULT_MS = 50_000;

/** Sentinel event type emitted to SSE subscribers when a job reaches terminal status. */
const TERMINAL_EVENT = '__terminal__';

export class Jobs extends Effect.Service<Jobs>()('oagent/Jobs', {
	effect: Effect.gen(function* () {
		const opencode = yield* OpenCode;
		const cursor = yield* Cursor;
		const grok = yield* Grok;
		const { db } = yield* Db;

		const resolveModel = (
			model: string,
		): Effect.Effect<
			{ backend: string; modelId: string },
			ModelResolutionError,
			never
		> =>
			Effect.gen(function* () {
				const colonIdx = model.indexOf(':');
				if (colonIdx !== -1) {
					const backend = model.slice(0, colonIdx);
					const modelId = model.slice(colonIdx + 1);
					if (
						backend !== 'opencode' &&
						backend !== 'cursor' &&
						backend !== 'grok'
					) {
						return yield* new ModelResolutionError({
							code: 'UNKNOWN_BACKEND',
							message: `Unknown backend "${backend}". Valid backends: opencode, cursor, grok.`,
						});
					}
					return { backend, modelId };
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

				return { backend: alias.backend, modelId: alias.model_id };
			});

		const liveEmitters = new Map<string, EventEmitter>();
		const liveFibers = new Map<string, Fiber.RuntimeFiber<JobOk, unknown>>();
		const jobsEmitter = new EventEmitter();
		jobsEmitter.setMaxListeners(0);

		const start = (input: {
			prompt: string;
			model?: string;
			sessionId?: string;
			cwd: string;
		}): Effect.Effect<{ jobId: string }, ModelResolutionError, never> =>
			Effect.gen(function* () {
				const uuid = randomUUIDv7();

				const model = input.model;
				if (model === undefined) {
					return yield* new ModelResolutionError({
						code: 'MISSING',
						message:
							'model is required: specify `<backend>:<modelId>` or an alias name',
					});
				}

				const { backend, modelId: rest } = yield* resolveModel(model);

				const jobRow = db
					.insert(schema.jobs)
					.values({
						uuid,
						status: 'running',
						prompt: input.prompt,
						cwd: input.cwd,
						model: rest,
						backend,
					})
					.returning({ id: schema.jobs.id })
					.get();
				if (jobRow === undefined) {
					throw new Error('Failed to insert job');
				}
				const internalId = jobRow.id;
				jobsEmitter.emit('change', { type: 'created', jobId: uuid });

				const emitter = new EventEmitter();
				emitter.setMaxListeners(0);
				liveEmitters.set(uuid, emitter);

				const onEvent = (event: SessionUpdate): void => {
					const eventId = insertSessionUpdate(db, internalId, event);
					emitter.emit('event', { event, sequence: eventId });
				};

				const closeResources = Effect.sync(() => {
					liveEmitters.delete(uuid);
					liveFibers.delete(uuid);
					emitter.emit(TERMINAL_EVENT);
				});

				const runTurnEffect = (() => {
					if (backend === 'opencode') {
						return opencode.runTurn({
							prompt: input.prompt,
							model: rest,
							sessionId: input.sessionId,
							cwd: input.cwd,
							onEvent,
						});
					}
					if (backend === 'grok') {
						return grok.runTurn({
							prompt: input.prompt,
							model: rest,
							sessionId: input.sessionId,
							cwd: input.cwd,
							onEvent,
						});
					}
					return cursor.runTurn({
						prompt: input.prompt,
						model: rest,
						sessionId: input.sessionId,
						cwd: input.cwd,
						onEvent,
						onExtensionEvent: (method, params) => {
							onEvent({
								sessionUpdate: 'cursor_extension',
								_meta: { method, params },
							} as unknown as SessionUpdate);
						},
					});
				})();

				const fiber = yield* Effect.forkDaemon(
					runTurnEffect.pipe(
						Effect.tap((result) =>
							Effect.sync(() => {
								db.update(schema.jobs)
									.set({
										status: 'done',
										session_id: result.sessionId,
										text: result.text,
										stop_reason: result.stopReason ?? null,
										terminated_at: new Date(),
									})
									.where(eq(schema.jobs.id, internalId))
									.run();
								jobsEmitter.emit('change', {
									type: 'status',
									jobId: uuid,
									status: 'done',
								});
							}),
						),
						Effect.tapError((error) =>
							Effect.sync(() => {
								db.update(schema.jobs)
									.set({
										status: 'error',
										error_message: formatJobError(error),
										terminated_at: new Date(),
									})
									.where(eq(schema.jobs.id, internalId))
									.run();
								jobsEmitter.emit('change', {
									type: 'status',
									jobId: uuid,
									status: 'error',
								});
							}),
						),
						Effect.ensuring(closeResources),
					),
				);

				liveFibers.set(uuid, fiber);
				return { jobId: uuid };
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

		const list = (): {
			id: string;
			status: 'running' | 'done' | 'error' | 'cancelled';
			createdAt: number;
			terminatedAt?: number;
			prompt: string;
			cwd: string;
			model?: string;
		}[] => {
			const rows = db
				.select()
				.from(schema.jobs)
				.orderBy(
					sql`(${schema.jobs.status} = 'running') DESC`,
					desc(schema.jobs.created_at),
				)
				.all();

			return rows.map((row) => ({
				id: row.uuid,
				status: row.status,
				createdAt: row.created_at.getTime(),
				terminatedAt: row.terminated_at?.getTime(),
				prompt: row.prompt,
				cwd: row.cwd,
				model: row.model ?? undefined,
			}));
		};

		const getDetail = (
			jobId: string,
		):
			| {
					id: string;
					status: 'running' | 'done' | 'error' | 'cancelled';
					createdAt: number;
					terminatedAt?: number;
					prompt: string;
					cwd: string;
					model?: string;
					recentEvents: SessionUpdate[];
			  }
			| undefined => {
			const job = db
				.select()
				.from(schema.jobs)
				.where(eq(schema.jobs.uuid, jobId))
				.limit(1)
				.get();
			if (job === undefined) return undefined;

			const allEvents: SessionUpdate[] = [];
			let cursor = 0;
			while (true) {
				const page = readSessionEventsPage(db, job.id, cursor, 100);
				for (const item of page.events) {
					allEvents.push(item.event);
				}
				if (page.nextCursor === null) break;
				cursor = page.nextCursor;
			}
			return {
				id: job.uuid,
				status: job.status,
				createdAt: job.created_at.getTime(),
				terminatedAt: job.terminated_at?.getTime(),
				prompt: job.prompt,
				cwd: job.cwd,
				model: job.model ?? undefined,
				recentEvents: allEvents,
			};
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
			description?: string | null;
		}) => {
			const now = new Date();
			db.insert(schema.modelAliases)
				.values({
					name: input.name,
					backend: input.backend,
					model_id: input.model_id,
					description: input.description ?? null,
					created_at: now,
					updated_at: now,
				})
				.onConflictDoUpdate({
					target: schema.modelAliases.name,
					set: {
						backend: input.backend,
						model_id: input.model_id,
						description: input.description ?? null,
						updated_at: now,
					},
				})
				.run();
			return {
				name: input.name,
				backend: input.backend,
				model_id: input.model_id,
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

		return {
			start,
			cancel,
			wait,
			list,
			getDetail,
			subscribe,
			subscribeJobs,
			listAliases,
			saveAlias,
			deleteAlias,
			readEventsPage: (jobId: string, sinceId: number, limit: number) => {
				const job = db
					.select()
					.from(schema.jobs)
					.where(eq(schema.jobs.uuid, jobId))
					.limit(1)
					.get();
				if (job === undefined) return { events: [], nextCursor: null };
				return readSessionEventsPage(db, job.id, sinceId, limit);
			},
		};
	}),
	dependencies: [OpenCode.Default, Cursor.Default, Grok.Default, Db.Default],
}) {}

function toWaitResult(job: {
	uuid: string;
	status: 'running' | 'done' | 'error' | 'cancelled';
	session_id: string | null;
	text: string | null;
	stop_reason: string | null;
	error_message: string | null;
}): WaitResult {
	if (job.status === 'running') return { status: 'running' };
	if (job.status === 'cancelled') return { status: 'cancelled' };
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
	return { status: 'error', message: job.error_message };
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
