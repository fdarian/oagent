import type { EngineRouter } from '@oagent/engine'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'

const baseURL = import.meta.env.DEV
  ? '/rpc'
  : (new URLSearchParams(location.search).get('engine') ?? '/rpc')

const link = new RPCLink({ url: () => new URL(baseURL, location.origin) })
export const orpc: RouterClient<EngineRouter> = createORPCClient(link)
