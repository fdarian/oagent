import { Effect } from 'effect';
import { z } from 'zod';
import type { Jobs } from '../../jobs.ts';

const description = `\
Fetch the result of an agent job, waiting briefly if it is still running. If it \
remains running, retry later or run \`oagent jobs wait <jobId>\` as a background \
command.`;

const WAIT_TIMEOUT_DEFAULT_MS = 50_000;
const WAIT_TIMEOUT_MAX_MS = 55_000;

const inputSchema = {
	jobId: z.string().describe('The jobId returned by `start`.'),
	timeoutMs: z
		.number()
		.optional()
		.describe('Maximum milliseconds to wait (default 50000, capped at 55000).'),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

export const resultTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { jobs: Jobs['Service'] }) {
		return Effect.map(
			ctx.jobs
				.wait({
					jobId: args.jobId,
					timeoutMs: Math.min(
						args.timeoutMs ?? WAIT_TIMEOUT_DEFAULT_MS,
						WAIT_TIMEOUT_MAX_MS,
					),
				})
				.pipe(
					Effect.catchTag('JobNotFound', (err) =>
						Effect.succeed({
							status: 'error' as const,
							message: `Job not found: ${err.jobId}`,
						}),
					),
				),
			(result) => ({
				content: [{ type: 'text' as const, text: JSON.stringify(result) }],
			}),
		);
	},
};
