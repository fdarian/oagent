/// <reference types="bun" />
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AcpRuntimeEvent } from 'acpx/runtime';
import { Duration, Effect, Fiber, Schedule, Schema } from 'effect';
import { OpenCode } from './opencode.ts';

export type { AcpRuntimeEvent };

class JobNotFound extends Schema.TaggedError<JobNotFound>()('JobNotFound', {
  jobId: Schema.String,
}) {}

type JobOk = {
  readonly sessionId: string;
  readonly text: string;
  readonly stopReason: string | undefined;
};
type JobErr = unknown;

type JobState =
  | {
      readonly status: 'running';
      readonly fiber: Fiber.RuntimeFiber<JobOk, JobErr>;
      readonly createdAt: number;
    }
  | {
      readonly status: 'done';
      readonly sessionId: string;
      readonly text: string;
      readonly stopReason: string | undefined;
      readonly createdAt: number;
      readonly terminatedAt: number;
    }
  | {
      readonly status: 'error';
      readonly message: string;
      readonly createdAt: number;
      readonly terminatedAt: number;
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

/** Per-job event log: ring buffer + live fanout emitter. */
type EventLog = {
  readonly ring: AcpRuntimeEvent[];
  readonly emitter: EventEmitter;
};

const TIMEOUT_DEFAULT_MS = 50_000;
const JOB_TTL_MS = 30 * 60_000;
const JOB_SWEEP_INTERVAL_MS = 5 * 60_000;
const RING_BUFFER_MAX = 200;

/** Sentinel event type emitted to SSE subscribers when a job reaches terminal status. */
const TERMINAL_EVENT = '__terminal__';

/** Base state directory, created lazily on first job start. */
const stateDir = path.join(os.tmpdir(), `oagent-${process.pid}`, 'jobs');

let stateDirEnsured = false;

function ensureStateDir(): void {
  if (stateDirEnsured) return;
  fs.mkdirSync(stateDir, { recursive: true });
  stateDirEnsured = true;
}

export class Jobs extends Effect.Service<Jobs>()('oagent/Jobs', {
  effect: Effect.gen(function* () {
    const opencode = yield* OpenCode;
    const map = new Map<string, JobState>();
    const eventLogs = new Map<string, EventLog>();

    const sweep = Effect.sync(() => {
      const now = Date.now();
      for (const [jobId, state] of map.entries()) {
        if (
          state.status !== 'running' &&
          now - state.terminatedAt > JOB_TTL_MS
        ) {
          map.delete(jobId);
          eventLogs.delete(jobId);
        }
      }
    });

    yield* Effect.forkDaemon(
      Effect.repeat(
        sweep,
        Schedule.spaced(Duration.millis(JOB_SWEEP_INTERVAL_MS)),
      ),
    );

    const start = (input: {
      prompt: string;
      model?: string;
      sessionId?: string;
      cwd: string;
    }) =>
      Effect.gen(function* () {
        ensureStateDir();

        const jobId = randomUUID();
        const createdAt = Date.now();

        const ring: AcpRuntimeEvent[] = [];
        const emitter = new EventEmitter();
        emitter.setMaxListeners(0);
        eventLogs.set(jobId, { ring, emitter });

        const ndjsonPath = path.join(stateDir, `${jobId}.ndjson`);
        const writeStream = fs.createWriteStream(ndjsonPath, { flags: 'a' });

        const onEvent = (event: AcpRuntimeEvent): void => {
          // Append to ring buffer, evict oldest if over capacity
          ring.push(event);
          if (ring.length > RING_BUFFER_MAX) {
            ring.shift();
          }
          // Write to ndjson file
          writeStream.write(`${JSON.stringify(event)}\n`);
          // Fanout to live SSE subscribers
          emitter.emit('event', event);
        };

        const closeResources = Effect.sync(() => {
          writeStream.end();
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
                  map.set(jobId, {
                    status: 'done',
                    sessionId: result.sessionId,
                    text: result.text,
                    stopReason: result.stopReason,
                    createdAt,
                    terminatedAt: Date.now(),
                  });
                }),
              ),
              Effect.tapError((error) =>
                Effect.sync(() => {
                  map.set(jobId, {
                    status: 'error',
                    message: formatJobError(error),
                    createdAt,
                    terminatedAt: Date.now(),
                  });
                }),
              ),
              Effect.ensuring(closeResources),
            ),
        );
        map.set(jobId, { status: 'running', fiber, createdAt });
        return { jobId };
      });

    const wait = (input: { jobId: string; timeoutMs?: number }) =>
      Effect.gen(function* () {
        const state = map.get(input.jobId);
        if (state === undefined) {
          return yield* Effect.fail(new JobNotFound({ jobId: input.jobId }));
        }

        if (state.status !== 'running') {
          return toWaitResult(state);
        }

        const cap = input.timeoutMs ?? TIMEOUT_DEFAULT_MS;

        yield* Fiber.join(state.fiber).pipe(
          Effect.exit,
          Effect.timeoutOption(cap),
        );

        const updated = map.get(input.jobId);
        if (updated === undefined) {
          return yield* Effect.fail(new JobNotFound({ jobId: input.jobId }));
        }
        return toWaitResult(updated);
      });

    /** Snapshot of all jobs, running first then terminal, sorted by most-recent. */
    const list = (): {
      id: string;
      status: JobState['status'];
      createdAt: number;
      terminatedAt?: number;
    }[] => {
      const entries = Array.from(map.entries()).map(([id, state]) => ({
        id,
        status: state.status,
        createdAt: state.createdAt,
        terminatedAt:
          state.status !== 'running' ? state.terminatedAt : undefined,
      }));
      entries.sort((a, b) => {
        // Running jobs first
        const aRunning = a.status === 'running' ? 1 : 0;
        const bRunning = b.status === 'running' ? 1 : 0;
        if (aRunning !== bRunning) return bRunning - aRunning;
        // Then most recent first
        return b.createdAt - a.createdAt;
      });
      return entries;
    };

    /** Pull state + ring buffer for a single job. Returns undefined if not found. */
    const getDetail = (
      jobId: string,
    ):
      | {
          id: string;
          status: JobState['status'];
          createdAt: number;
          terminatedAt?: number;
          recentEvents: AcpRuntimeEvent[];
        }
      | undefined => {
      const state = map.get(jobId);
      if (state === undefined) return undefined;
      const log = eventLogs.get(jobId);
      return {
        id: jobId,
        status: state.status,
        createdAt: state.createdAt,
        terminatedAt:
          state.status !== 'running' ? state.terminatedAt : undefined,
        recentEvents: log !== undefined ? [...log.ring] : [],
      };
    };

    /**
     * Subscribe to live events for a job.
     * The listener is called with each new AcpRuntimeEvent.
     * When the job reaches terminal status the listener is called with the
     * synthetic string `'__terminal__'` so the SSE handler can close.
     * Returns an unsubscribe function.
     */
    const subscribe = (
      jobId: string,
      listener: (event: AcpRuntimeEvent | typeof TERMINAL_EVENT) => void,
    ): (() => void) => {
      const log = eventLogs.get(jobId);
      if (log === undefined) return () => {};

      const onEvent = (event: AcpRuntimeEvent) => listener(event);
      const onTerminal = () => listener(TERMINAL_EVENT);

      log.emitter.on('event', onEvent);
      log.emitter.once(TERMINAL_EVENT, onTerminal);

      return () => {
        log.emitter.off('event', onEvent);
        log.emitter.off(TERMINAL_EVENT, onTerminal);
      };
    };

    return { start, wait, list, getDetail, subscribe };
  }),
  dependencies: [OpenCode.Default],
}) {}

function toWaitResult(state: JobState): WaitResult {
  if (state.status === 'running') return { status: 'running' };
  if (state.status === 'done')
    return {
      status: 'done',
      sessionId: state.sessionId,
      text: state.text,
      stopReason: state.stopReason,
    };
  return { status: 'error', message: state.message };
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
