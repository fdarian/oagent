import { randomUUID } from 'node:crypto';
import { Duration, Effect, Fiber, Schedule, Schema } from 'effect';
import { OpenCode } from '#/opencode';

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
    }
  | {
      readonly status: 'done';
      readonly sessionId: string;
      readonly text: string;
      readonly stopReason: string | undefined;
      readonly terminatedAt: number;
    }
  | {
      readonly status: 'error';
      readonly message: string;
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

const TIMEOUT_DEFAULT_MS = 50_000;
const TIMEOUT_MAX_MS = 55_000;
const JOB_TTL_MS = 30 * 60_000;
const JOB_SWEEP_INTERVAL_MS = 5 * 60_000;

export class Jobs extends Effect.Service<Jobs>()('opencode-mcp/Jobs', {
  effect: Effect.gen(function* () {
    const opencode = yield* OpenCode;
    const map = new Map<string, JobState>();

    const sweep = Effect.sync(() => {
      const now = Date.now();
      for (const [jobId, state] of map.entries()) {
        if (
          state.status !== 'running' &&
          now - state.terminatedAt > JOB_TTL_MS
        ) {
          map.delete(jobId);
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
        const jobId = randomUUID();
        const fiber = yield* Effect.forkDaemon(
          opencode.runTurn(input).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                map.set(jobId, {
                  status: 'done',
                  sessionId: result.sessionId,
                  text: result.text,
                  stopReason: result.stopReason,
                  terminatedAt: Date.now(),
                });
              }),
            ),
            Effect.tapError((error) =>
              Effect.sync(() => {
                map.set(jobId, {
                  status: 'error',
                  message: formatJobError(error),
                  terminatedAt: Date.now(),
                });
              }),
            ),
          ),
        );
        map.set(jobId, { status: 'running', fiber });
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

        const cap = Math.min(
          input.timeoutMs ?? TIMEOUT_DEFAULT_MS,
          TIMEOUT_MAX_MS,
        );

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

    return { start, wait };
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
