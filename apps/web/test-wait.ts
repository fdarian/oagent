import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'

const link = new RPCLink({ url: () => new URL('http://127.0.0.1:27777/rpc') })
const client = createORPCClient(link)

const result = await client.jobs.wait({ jobId: '019e0237-583e-7000-a8aa-4cc41b0d22af' })
console.log('wait result:', JSON.stringify(result))
