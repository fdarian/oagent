import { Effect } from 'effect';
import { z } from 'zod';
import type { Jobs } from '../../jobs.ts';

const description = `\
Delegate a task to the coding agent, running as a subprocess. \
Semantically equivalent to Claude Code's built-in Agent tool, but the underlying \
agent is the coding agent. Returns immediately with {jobId, waitUrl?}. If waitUrl is \
present, the recommended way to wait is to run \`curl -sS <waitUrl>\` as a \
background Bash command (run_in_background=true), then read the result with \
BashOutput when ready. The curl returns the same JSON shape as result. \
Optionally pass ?timeoutMs=N to the curl URL (default 600000 = 10min). The shell \
will block until the job is terminal or the timeout fires; on timeout the response \
is {status:"running"} and you can curl again. If waitUrl is absent (stdio mode), \
fall back to repeatedly calling result. The first successful response \
with status "done" will include the agent sessionId; pass that sessionId back \
into a subsequent start call to continue the same conversation. The model \
parameter takes a model id for the agent backend. If the user hasn't specified a \
model, ask them which one to use. The cwd parameter is required: an absolute \
path to the directory the agent should operate in — typically the parent agent's \
project root.`;

const inputSchema = {
	prompt: z.string().describe('The task or question to send to the agent.'),
	cwd: z
		.string()
		.describe(
			"Absolute path to the directory the agent should operate in — typically the parent agent's project root.",
		),
	model: z
		.string()
		.optional()
		.describe(
			'Model id for the agent backend. Omit only if the user has not specified one; in that case, ask the user.',
		),
	sessionId: z
		.string()
		.optional()
		.describe(
			'Resume a prior session. Pass the sessionId returned from a previous result done response.',
		),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

export const startTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { jobs: Jobs; waitUrlBase: string | undefined }) {
		return Effect.map(ctx.jobs.start(args), (result) => {
			const response =
				ctx.waitUrlBase !== undefined
					? {
							jobId: result.jobId,
							waitUrl: `${ctx.waitUrlBase}/jobs/${result.jobId}/wait`,
						}
					: { jobId: result.jobId };
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(response) }],
			};
		});
	},
};
