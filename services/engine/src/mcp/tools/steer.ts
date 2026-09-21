import { Effect } from 'effect';
import { z } from 'zod';
import type { Jobs } from '../../jobs.ts';

const description = `\
Add an instruction to a running agent job's in-flight turn.

The instruction is durably queued for the agent and lands at its next step boundary. It does not immediately interrupt a model response or tool call already in progress. Steering is supported only for OpenCode v2 or newer.`;

const inputSchema = {
	jobId: z.string().describe('The jobId returned by start.'),
	prompt: z.string().describe('The additional instruction to give the agent.'),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

export const steerTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { jobs: Jobs['Service'] }) {
		return Effect.map(ctx.jobs.steer(args.jobId, args.prompt), () => ({
			content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }],
		}));
	},
};
