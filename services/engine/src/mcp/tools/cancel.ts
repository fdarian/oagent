import { Effect } from 'effect';
import { z } from 'zod';
import type { Jobs } from '../../jobs.ts';

const description = `\
Cancel an agent job. Returns \`{ ok: true }\` when the job exists or \`{ ok: false }\` \
when it does not; cancelling a terminal job is a no-op.`;

const inputSchema = {
	jobId: z.string().describe('The jobId returned by `start`.'),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

export const cancelTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { jobs: Jobs['Service'] }) {
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
