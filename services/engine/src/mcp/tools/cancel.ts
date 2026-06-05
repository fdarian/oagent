import { Effect } from 'effect';
import { z } from 'zod';
import type { Jobs } from '../../jobs.ts';

const description = `\
Cancel a running agent job started via \`start\`. Interrupts the underlying agent session and marks the job 'cancelled'.

Returns
- { ok: true } if the job was found (whether it was actually running or already terminal)
- { ok: false } if no job with that jobId exists.

Cancelling an already-terminal job is a no-op.`;

const inputSchema = {
	jobId: z.string().describe('The jobId returned by start.'),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

export const cancelTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { jobs: Jobs }) {
		return Effect.map(
			ctx.jobs.cancel(args).pipe(
				Effect.map(() => ({ ok: true })),
				Effect.catchTag('JobNotFound', () => Effect.succeed({ ok: false })),
			),
			(result) => ({
				content: [{ type: 'text' as const, text: JSON.stringify(result) }],
			}),
		);
	},
};
