import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({ url: () => new URL('http://127.0.0.1:27777/rpc') })
const client = createORPCClient(link)

const result = await client.jobs.start({ prompt: 'write a 50 word story about a cat', cwd: '/tmp' })
console.log('jobId:', result.jobId)
