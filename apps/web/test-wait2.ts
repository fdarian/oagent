import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({ url: () => new URL('http://127.0.0.1:27777/rpc') })
const client = createORPCClient(link)

const result = await client.jobs.wait({ jobId: '019e0239-8739-7000-88fa-2e24c39f3e03' })
console.log('wait result:', JSON.stringify(result))
