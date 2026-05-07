import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({ url: () => new URL('http://127.0.0.1:27777/rpc') })
const client = createORPCClient(link)

const result = await client.jobs.start({ prompt: 'echo hello2', cwd: '/tmp' })
console.log('start result:', JSON.stringify(result))

const list = await client.jobs.list()
console.log('list:', JSON.stringify(list))
