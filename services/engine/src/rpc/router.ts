import { os } from '@orpc/server';
import { Effect } from 'effect';
import { createHandler } from 'ff-effect/for/orpc';
import * as v from 'valibot';
import { Jobs } from '../jobs.ts';

const program = Effect.gen(function* () {
  const jobs = yield* Jobs;

  return {
    jobs: {
      list: yield* createHandler(
        os.input(v.void_()).output(
          v.array(
            v.object({
              id: v.string(),
              status: v.picklist(['running', 'done', 'error']),
              createdAt: v.number(),
              terminatedAt: v.optional(v.number()),
              prompt: v.string(),
              cwd: v.string(),
              model: v.optional(v.string()),
            }),
          ),
        ),
        () => Effect.succeed(jobs.list()),
      ),
      get: yield* createHandler(
        os.input(v.object({ jobId: v.string() })).output(
          v.optional(
            v.object({
              id: v.string(),
              status: v.picklist(['running', 'done', 'error']),
              createdAt: v.number(),
              terminatedAt: v.optional(v.number()),
              prompt: v.string(),
              cwd: v.string(),
              model: v.optional(v.string()),
            }),
          ),
        ),
        (opt) => {
          const detail = jobs.getDetail(opt.input.jobId);
          if (detail === undefined) return Effect.succeed(undefined);
          return Effect.succeed({
            id: detail.id,
            status: detail.status,
            createdAt: detail.createdAt,
            terminatedAt: detail.terminatedAt,
            prompt: detail.prompt,
            cwd: detail.cwd,
            model: detail.model,
          });
        },
      ),
      start: yield* createHandler(
        os
          .input(
            v.object({
              prompt: v.string(),
              cwd: v.string(),
              model: v.optional(v.string()),
              sessionId: v.optional(v.string()),
            }),
          )
          .output(v.object({ jobId: v.string() })),
        Effect.fn(function* (opt) {
          return yield* jobs.start(opt.input);
        }),
      ),
      wait: yield* createHandler(
        os
          .input(
            v.object({
              jobId: v.string(),
              timeoutMs: v.optional(v.number()),
            }),
          )
          .output(
            v.union([
              v.object({ status: v.literal('running') }),
              v.object({
                status: v.literal('done'),
                sessionId: v.string(),
                text: v.string(),
                stopReason: v.optional(v.string()),
              }),
              v.object({ status: v.literal('error'), message: v.string() }),
            ]),
          ),
        Effect.fn(function* (opt) {
          return yield* jobs.wait(opt.input).pipe(
            Effect.catchTag('JobNotFound', (err) =>
              Effect.succeed({
                status: 'error' as const,
                message: `Job not found: ${err.jobId}`,
              }),
            ),
          );
        }),
      ),
    },
  };
});

export type EngineRouter = Effect.Effect.Success<typeof program>;
export { program };
