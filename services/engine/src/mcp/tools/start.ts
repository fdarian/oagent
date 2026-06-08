import { Effect } from 'effect';
import { z } from 'zod';
import type { Jobs } from '../../jobs.ts';

const BASE_DESCRIPTION = `\
Launch or continue an agent.

It returns the final result as a discriminated union:
- Success: \`{ status: "done", text, sessionId, stopReason }\` — the final aggregated assistant text plus the \`sessionId\` you can pass back into a subsequent \`start\` call to continue the same conversation
- Error: \`{ status: "error", message }\` — the job terminated with an error 
- Cancelled: \`{ status: "cancelled" }\`
- Pending: \`{ status: "running", jobId }\` — the job is still running. Wait by running \`oagent jobs wait <jobId>\` verbatim as a background command (it can block for many minutes). Do NOT pipe, redirect, or wrap it (no \`| tail\`, \`2>&1\`, \`echo $?\`, etc.) — it prints exactly one JSON result line to stdout that you read directly.

If this tool timed-out, you can find the jobId from \`oagent jobs list\``;

export type AliasPreset = {
	name: string;
	backend: string;
	model_id: string;
	description: string | null;
};

/** Renders the preset/alias suffix shared by every `start` tool description. Empty when there are no aliases. */
export function formatPresets(aliases: AliasPreset[]): string {
	if (aliases.length === 0) {
		return '';
	}

	const maxNameLen = Math.max(...aliases.map((a) => a.name.length));
	const lines = aliases.map((a) => {
		const padded = a.name.padEnd(maxNameLen, ' ');
		const desc =
			a.description !== null && a.description !== ''
				? ` — ${a.description}`
				: '';
		return `  - \`${padded}\` → ${a.backend}:${a.model_id}${desc}`;
	});

	return `

Available presets (use as \`model\` or pass the raw \`<backend>:<modelId>\` form):
${lines.join('\n')}`;
}

export function buildDescription(aliases: AliasPreset[]): string {
	return `${BASE_DESCRIPTION}${formatPresets(aliases)}`;
}

/**
 * Max time the start tool blocks waiting for a job before returning a running handle.
 *
 * Safe because Claude Code's MCP tool-call timeout defaults to ~27.7h (1e8 ms): from
 * the client binary, the per-call limit resolves as `.mcp.json` timeout → MCP_TOOL_TIMEOUT
 * env → 1e8 ms default, floored at 1s, ceiled at INT32_MAX (~24.8 days). The server can NOT
 * read that value — Claude Code injects no timeout into the MCP subprocess env (only
 * CLAUDE_PROJECT_DIR) — and progress notifications do NOT extend it (hard wall-clock). So we
 * pick our own conservative cap well under the default and hand back a {status:"running"}
 * resume handle if it elapses, rather than trying to detect the client's limit.
 */
const BLOCKING_WAIT_TIMEOUT_MS = 30 * 60 * 1000;

export const inputSchema = {
	prompt: z.string().describe('The task instructions'),
	cwd: z
		.string()
		.describe('Absolute path to the directory the agent should operate in'),
	model: z
		.string()
		.optional()
		.describe(
			'Model id in either: `<backend>:<modelId>` format or an `alias`. If the user has not specified a model, ask them which model and backend to use.',
		),
	sessionId: z
		.string()
		.optional()
		.describe(
			'Resume a prior session. Pass the `sessionId` returned from a previous result done response.',
		),
	background: z
		.boolean()
		.optional()
		.describe(
			'`false` (default), block until the job finishes (up to 30 minutes) and return the final result; When `true`, return immediately with `{ status:"running", jobId }`',
		),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

export const startTool = {
	inputSchema,
	handle(args: Args, ctx: { jobs: Jobs; waitUrlBase: string | undefined }) {
		const runningResponse = (jobId: string) => ({
			status: 'running' as const,
			jobId,
		});

		return ctx.jobs.start(args).pipe(
			Effect.flatMap((result) => {
				if (args.background === true) {
					return Effect.succeed(runningResponse(result.jobId));
				}
				return ctx.jobs
					.wait({
						jobId: result.jobId,
						timeoutMs: BLOCKING_WAIT_TIMEOUT_MS,
					})
					.pipe(
						Effect.map((wait) =>
							wait.status === 'running' ? runningResponse(result.jobId) : wait,
						),
						Effect.catchTag('JobNotFound', (err) =>
							Effect.succeed({
								status: 'error' as const,
								message: `Job not found: ${err.jobId}`,
							}),
						),
					);
			}),
			Effect.map((response) => ({
				content: [{ type: 'text' as const, text: JSON.stringify(response) }],
			})),
			Effect.catchTag('ModelResolutionError', (err) =>
				Effect.succeed({
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: { code: err.code, message: err.message },
							}),
						},
					],
				}),
			),
		);
	},
};
