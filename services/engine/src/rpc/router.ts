import * as v from 'valibot'
import { Effect } from 'effect'
import { os } from '@orpc/server'
import { createHandler } from 'ff-effect/for/orpc'
import { Jobs } from '../jobs.ts'

const acpEventSchema = v.lazy(() =>
  v.union([
    v.object({
      type: v.literal('text_delta'),
      text: v.string(),
      stream: v.optional(v.union([v.literal('output'), v.literal('thought')])),
      tag: v.optional(v.string()),
    }),
    v.object({
      type: v.literal('status'),
      text: v.string(),
      tag: v.optional(v.string()),
      used: v.optional(v.number()),
      size: v.optional(v.number()),
    }),
    v.object({
      type: v.literal('tool_call'),
      text: v.string(),
      tag: v.optional(v.string()),
      toolCallId: v.optional(v.string()),
      status: v.optional(v.string()),
      title: v.optional(v.string()),
    }),
    v.object({
      type: v.literal('done'),
      stopReason: v.optional(v.string()),
    }),
    v.object({
      type: v.literal('error'),
      message: v.string(),
      code: v.optional(v.string()),
      retryable: v.optional(v.boolean()),
    }),
  ]),
)

const program = Effect.gen(function*() {
  const jobs = yield* Jobs

  return {
    jobs: {
      list: yield* createHandler(
        os.input(v.void_()).output(
          v.array(
            v.object({
              id: v.string(),
              status: v.string(),
              createdAt: v.number(),
              terminatedAt: v.optional(v.number()),
            }),
          ),
        ),
        Effect.fn(function*() {
          return jobs.list()
        }),
      ),
      get: yield* createHandler(
        os.input(v.object({ jobId: v.string() })).output(
          v.optional(
            v.object({
              id: v.string(),
              status: v.string(),
              createdAt: v.number(),
              terminatedAt: v.optional(v.number()),
              recentEvents: v.array(acpEventSchema),
            }),
          ),
        ),
        Effect.fn(function* (opt) {
          return jobs.getDetail(opt.input.jobId)
        }),
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
          return yield* jobs.start(opt.input)
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
          )
        }),
      ),
    },
  }
})

export type EngineRouter = Effect.Effect.Success<typeof program>
export { program }
