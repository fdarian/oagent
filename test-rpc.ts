import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({ url: () => new URL('http://127.0.0.1:27777/rpc') })
const client = createORPCClient(link)

const result = await client.jobs.start.call({ prompt: 'echo hello', cwd: '/tmp' })
console.log('start result:', JSON.stringify(result))

const list = await client.jobs.list.call()
console.log('list:', JSON.stringify(list))
