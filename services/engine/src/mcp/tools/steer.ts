import { Effect } from 'effect';
import { z } from 'zod';
import type { Jobs } from '../../jobs.ts';
import { requestLogFields } from '../../request-log.ts';

const description = `\
Queue an instruction for a running agent job; it is delivered at the next step \
boundary. Returns \`{ ok: true }\`; supported for OpenCode v2+ jobs.`;

const inputSchema = {
	jobId: z.string().describe('The jobId returned by `start`.'),
	prompt: z.string().describe('The instruction to queue for the agent.'),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

export const steerTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { jobs: Jobs['Service'] }) {
		return Effect.gen(function* () {
			yield* Effect.logInfo(
				`MCP steer ${requestLogFields({ jobId: args.jobId })}`,
			);
			yield* ctx.jobs.steer(args.jobId, args.prompt);
			return {
				content: [
					{ type: 'text' as const, text: JSON.stringify({ ok: true }) },
				],
			};
		});
	},
};
