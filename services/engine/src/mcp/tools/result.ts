import { Effect } from 'effect';
import { z } from 'zod';
import type { Jobs } from '../../jobs.ts';

const description = `\
Fetch the result of an agent job (started via start). In HTTP daemon \
mode, prefer the waitUrl from start; this tool is the stdio-mode \
fallback. Blocks up to timeoutMs (default 50000, capped at 55000 to stay under \
Claude Code's tool timeout). Returns a discriminated union: { status: "running" } \
— call again to keep waiting; { status: "done", text, sessionId, stopReason } — \
the final aggregated assistant text plus the sessionId you can pass back to \
start to continue the same conversation; { status: "error", message } — \
the job terminated with an error. Always poll until status is "done" or "error" \
before treating the task as complete.`;

const WAIT_TIMEOUT_DEFAULT_MS = 50_000;
const WAIT_TIMEOUT_MAX_MS = 55_000;

const inputSchema = {
	jobId: z.string().describe('The jobId returned by start.'),
	timeoutMs: z
		.number()
		.optional()
		.describe('Max milliseconds to block (default 50000, capped at 55000).'),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

export const resultTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { jobs: Jobs }) {
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
