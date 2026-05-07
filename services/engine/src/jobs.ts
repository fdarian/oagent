/// <reference types="bun" />
import { randomUUIDv7 } from 'bun';
import { EventEmitter } from 'node:events';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { and, eq, gt, sql } from 'drizzle-orm';
import { Duration, Effect, Fiber, Schema } from 'effect';
import { assembleEvent } from './db/assembleEvent.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { OpenCode } from './opencode.ts';

class JobNotFound extends Schema.TaggedError<JobNotFound>()('JobNotFound', {
  jobId: Schema.String,
}) {}

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
  | { readonly status: 'error'; readonly message: string };

const TIMEOUT_DEFAULT_MS = 50_000;

/** Sentinel event type emitted to SSE subscribers when a job reaches terminal status. */
const TERMINAL_EVENT = '__terminal__';

export class Jobs extends Effect.Service<Jobs>()('oagent/Jobs', {
  effect: Effect.gen(function* () {
    const opencode = yield* OpenCode;
    const { db } = yield* Db;

    const liveEmitters = new Map<string, EventEmitter>();
    const liveFibers = new Map<string, Fiber.RuntimeFiber<JobOk, unknown>>();

    const insertEvent = (jobId: number, event: SessionUpdate): number => {
      return db.transaction((tx) => {
        const meta =
          '_meta' in event && event._meta !== undefined && event._meta !== null
            ? (event._meta as Record<string, unknown>)
            : null;

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
            tx.insert(schema.chunkEvents).values({
              event_id: eventId,
              message_id: event.messageId ?? null,
              content: event.content,
            }).run();
            break;
          }
          case 'tool_call':
          case 'tool_call_update': {
            tx.insert(schema.toolCallEvents).values({
              event_id: eventId,
              tool_call_id: event.toolCallId,
              title: event.title ?? null,
              status: event.status ?? null,
              kind: event.kind ?? null,
              content: event.content ?? null,
              locations: event.locations ?? null,
              raw_input: event.rawInput ?? null,
              raw_output: event.rawOutput ?? null,
            }).run();
            break;
          }
          case 'plan': {
            tx.insert(schema.planEvents).values({
              event_id: eventId,
              entries: event.entries,
            }).run();
            break;
          }
          case 'available_commands_update': {
            tx.insert(schema.availableCommandsEvents).values({
              event_id: eventId,
              available_commands: event.availableCommands,
            }).run();
            break;
          }
          case 'current_mode_update': {
            tx.insert(schema.currentModeEvents).values({
              event_id: eventId,
              current_mode_id: event.currentModeId,
            }).run();
            break;
          }
          case 'config_option_update': {
            tx.insert(schema.configOptionEvents).values({
              event_id: eventId,
              config_options: event.configOptions,
            }).run();
            break;
          }
          case 'session_info_update': {
            tx.insert(schema.sessionInfoEvents).values({
              event_id: eventId,
              title: event.title ?? null,
              updated_at: event.updatedAt ?? null,
            }).run();
            break;
          }
          case 'usage_update': {
            tx.insert(schema.usageEvents).values({
              event_id: eventId,
              size: event.size,
              used: event.used,
              cost_amount: event.cost?.amount ?? null,
              cost_currency: event.cost?.currency ?? null,
            }).run();
            break;
          }
        }

        return eventId;
      });
    };

    const readEventsSince = (jobId: number, sinceId: number): { event: SessionUpdate; sequence: number }[] => {
      const rows = db
        .select()
        .from(schema.events)
        .leftJoin(schema.chunkEvents, eq(schema.events.id, schema.chunkEvents.event_id))
        .leftJoin(schema.toolCallEvents, eq(schema.events.id, schema.toolCallEvents.event_id))
        .leftJoin(schema.planEvents, eq(schema.events.id, schema.planEvents.event_id))
        .leftJoin(schema.availableCommandsEvents, eq(schema.events.id, schema.availableCommandsEvents.event_id))
        .leftJoin(schema.currentModeEvents, eq(schema.events.id, schema.currentModeEvents.event_id))
        .leftJoin(schema.configOptionEvents, eq(schema.events.id, schema.configOptionEvents.event_id))
        .leftJoin(schema.sessionInfoEvents, eq(schema.events.id, schema.sessionInfoEvents.event_id))
        .leftJoin(schema.usageEvents, eq(schema.events.id, schema.usageEvents.event_id))
        .where(and(eq(schema.events.job_id, jobId), gt(schema.events.id, sinceId)))
        .orderBy(schema.events.created_at, schema.events.id)
        .all();

      return rows.map((row) => {
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
            title: row.tool_call_events?.title ?? null,
            status: row.tool_call_events?.status ?? null,
            kind: row.tool_call_events?.kind ?? null,
            locations: row.tool_call_events?.locations ?? null,
            raw_input: row.tool_call_events?.raw_input ?? null,
            raw_output: row.tool_call_events?.raw_output ?? null,
            entries: row.plan_events?.entries ?? null,
            available_commands: row.available_commands_events?.available_commands ?? null,
            current_mode_id: row.current_mode_events?.current_mode_id ?? null,
            config_options: row.config_option_events?.config_options ?? null,
            updated_at: row.session_info_events?.updated_at ?? null,
            size: row.usage_events?.size ?? null,
            used: row.usage_events?.used ?? null,
            cost_amount: row.usage_events?.cost_amount ?? null,
            cost_currency: row.usage_events?.cost_currency ?? null,
          },
        );
        return { event, sequence: row.events.id };
      });
    };

    const start = (input: {
      prompt: string;
      model?: string;
      sessionId?: string;
      cwd: string;
    }): Effect.Effect<{ jobId: string }, never, never> =>
      Effect.gen(function* () {
        const uuid = randomUUIDv7();

        const jobRow = db
          .insert(schema.jobs)
          .values({
            uuid,
            status: 'running',
            prompt: input.prompt,
            cwd: input.cwd,
            model: input.model ?? null,
          })
          .returning({ id: schema.jobs.id })
          .get();
        if (jobRow === undefined) {
          throw new Error('Failed to insert job');
        }
        const internalId = jobRow.id;

        const emitter = new EventEmitter();
        emitter.setMaxListeners(0);
        liveEmitters.set(uuid, emitter);

        const onEvent = (event: SessionUpdate): void => {
          const eventId = insertEvent(internalId, event);
          emitter.emit('event', { event, sequence: eventId });
        };

        const closeResources = Effect.sync(() => {
          liveEmitters.delete(uuid);
          liveFibers.delete(uuid);
          emitter.emit(TERMINAL_EVENT);
        });

        const fiber = yield* Effect.forkDaemon(
          opencode
            .runTurn({
              prompt: input.prompt,
              model: input.model,
              sessionId: input.sessionId,
              cwd: input.cwd,
              onEvent,
            })
            .pipe(
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
                }),
              ),
              Effect.ensuring(closeResources),
            ),
        );

        liveFibers.set(uuid, fiber);
        return { jobId: uuid };
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
          yield* Fiber.join(fiber).pipe(
            Effect.exit,
            Effect.timeoutOption(cap),
          );

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
      status: 'running' | 'done' | 'error';
      createdAt: number;
      terminatedAt?: number;
      prompt: string;
      cwd: string;
      model?: string;
    }[] => {
      const rows = db
        .select()
        .from(schema.jobs)
        .orderBy(sql`(${schema.jobs.status} = 'running') DESC`, schema.jobs.created_at)
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
          status: 'running' | 'done' | 'error';
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

      const events = readEventsSince(job.id, 0);
      return {
        id: job.uuid,
        status: job.status,
        createdAt: job.created_at.getTime(),
        terminatedAt: job.terminated_at?.getTime(),
        prompt: job.prompt,
        cwd: job.cwd,
        model: job.model ?? undefined,
        recentEvents: events.map((e) => e.event),
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
        listener({ type: 'event', event: payload.event, sequence: payload.sequence });
      const onTerminal = () => listener({ type: 'terminal' });

      emitter.on('event', onEvent);
      emitter.once(TERMINAL_EVENT, onTerminal);

      return () => {
        emitter.off('event', onEvent);
        emitter.off(TERMINAL_EVENT, onTerminal);
      };
    };

    return { start, wait, list, getDetail, subscribe, readEventsSince: (jobId: string, sinceId: number) => {
      const job = db.select().from(schema.jobs).where(eq(schema.jobs.uuid, jobId)).limit(1).get();
      if (job === undefined) return [];
      return readEventsSince(job.id, sinceId);
    } };
  }),
  dependencies: [OpenCode.Default, Db.Default],
}) {}

function toWaitResult(
  job: {
    uuid: string;
    status: 'running' | 'done' | 'error';
    session_id: string | null;
    text: string | null;
    stop_reason: string | null;
    error_message: string | null;
  },
): WaitResult {
  if (job.status === 'running') return { status: 'running' };
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
