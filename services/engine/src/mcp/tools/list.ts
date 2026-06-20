import { Effect } from 'effect';
import type { z } from 'zod';
import type { Jobs } from '../../jobs.ts';

const description = `\
List all agent jobs spawned by the current MCP session.

Returns a markdown summary of each job: id, status, prompt, and creation time.
Only available in /mcp HTTP mode where a session id is tracked.`;

const inputSchema = {};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

function formatJobs(jobs: ReturnType<Jobs['listByMcpSession']>): string {
	if (jobs.length === 0) {
		return 'No jobs in this session yet.';
	}

	const lines = [
		`# Session jobs (${jobs.length})`,
		'',
		...jobs.map((job) => {
			const oneLine = job.prompt.replace(/\n/g, ' ');
			const promptSummary =
				oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
			const created = new Date(job.createdAt).toISOString();
			const model = job.model !== undefined ? ` · ${job.model}` : '';
			return `- **${job.id}** [${job.status}] ${created}${model}\n  ${promptSummary}`;
		}),
	];

	return lines.join('\n');
}

export const listTool = {
	description,
	inputSchema,
	handle(_args: Args, ctx: { jobs: Jobs; mcpSessionId: string | undefined }) {
		const sessionId = ctx.mcpSessionId;
		if (sessionId === undefined) {
			return Effect.fail(
				new Error(
					'The `list` tool requires an MCP session. It is only available in /mcp HTTP mode.',
				),
			);
		}
		return Effect.sync(() => {
			const jobs = ctx.jobs.listByMcpSession(sessionId);
			return {
				content: [{ type: 'text' as const, text: formatJobs(jobs) }],
			};
		});
	},
};
