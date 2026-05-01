import * as v from 'valibot'
import { Effect } from 'effect'
import { os } from '@orpc/server'
import { Jobs } from '../jobs.ts'

const program = Effect.gen(function*() {
  const jobs = yield* Jobs

  return {
    jobs: {
      list: os.input(v.void_()).handler(() => jobs.list()),
      get: os.input(v.object({ jobId: v.string() })).handler((opt) =>
        jobs.getDetail(opt.input.jobId)
      ),
      start: os.input(v.object({
        prompt: v.string(),
        cwd: v.string(),
        model: v.optional(v.string()),
        sessionId: v.optional(v.string()),
      })).handler(async (opt) =>
        Effect.runPromise(jobs.start(opt.input))
      ),
      wait: os.input(v.object({
        jobId: v.string(),
        timeoutMs: v.optional(v.number()),
      })).handler(async (opt) =>
        Effect.runPromise(
          jobs.wait(opt.input).pipe(
            Effect.catchTag('JobNotFound', (err) =>
              Effect.succeed({ status: 'error', message: `Job not found: ${err.jobId}` })
            )
          )
        )
      ),
    }
  }
}).pipe(Effect.provide(Jobs.Default))

export type EngineRouter = Effect.Effect.Success<typeof program>
export { program }
