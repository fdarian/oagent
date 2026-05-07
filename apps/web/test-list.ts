import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({ url: () => new URL('http://127.0.0.1:27777/rpc') })
const client = createORPCClient(link)

const list = await client.jobs.list()
console.log('list:', JSON.stringify(list, null, 2))
