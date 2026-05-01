import { StandardRPCHandler } from '@orpc/server/standard'
import { FetchHandler } from '@orpc/server/fetch'
import { Effect } from 'effect'
import { program } from './router.ts'

export const createEngineHandler = Effect.gen(function*() {
  const router = yield* program
  const standardHandler = new StandardRPCHandler(router)
  const fetchHandler = new FetchHandler(standardHandler)
  return fetchHandler
})
