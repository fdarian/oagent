import { Effect } from 'effect';
import { z } from 'zod';
import type { Jobs } from '../../jobs.ts';

const BASE_DESCRIPTION = `\
Delegate a task to the coding agent, running as a subprocess. \
Semantically equivalent to Claude Code's built-in Agent tool, but the underlying \
agent is the coding agent. Supports two backends: OpenCode and Cursor CLI. \
By default this BLOCKS until the job finishes (up to 30 minutes) and returns the \
final result as a discriminated union: { status: "done", text, sessionId, stopReason } \
— the final aggregated assistant text plus the sessionId you can pass back into a \
subsequent start call to continue the same conversation; { status: "error", message } \
— the job terminated with an error; { status: "cancelled" }. If the job is still \
running after 30 minutes, returns { status: "running", jobId, waitUrl? } so you can \
keep waiting (see below). \
Pass \`background: true\` to skip blocking and return { status: "running", jobId, waitUrl? } \
immediately. To wait on a running job, run \`oagent jobs wait <jobId>\` as a background \
Bash command (run_in_background=true), then read the result with BashOutput when ready; \
it returns the same JSON shape and on its own timeout responds { status: "running" } so \
you can run it again. Requires the \`oagent\` binary on PATH. Optional flags: \
\`--timeout-ms N\` (overall wait budget, default 10800000 = 3h) and \`--engine-url URL\`. \
As a fallback, if waitUrl is present you can instead run \`curl -sS <waitUrl>\` (also \
background + BashOutput; optional ?timeoutMs=N, default 600000 = 10min); if waitUrl \
is absent (stdio mode), repeatedly call result. \
The cwd parameter is required: an absolute path to the directory the agent should \
operate in — typically the parent agent's project root.`;

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

	return `\n\nAvailable presets (use as \`model\` or pass the raw \`<backend>:<modelId>\` form):\n${lines.join('\n')}\n\nPresets are loaded at engine startup. Adding or editing an alias requires restarting the engine for the new list to appear here.`;
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
			'Model id in `<backend>:<modelId>` format or a preset alias name. Valid backends: `opencode`, `cursor`. Examples: `opencode:opencode-go/kimi-k2.6`, `cursor:auto`, `cursor:composer-2.5`, `cursor:sonnet`. For Cursor, friendly names map to the actual bracketed model ids; raw bracketed ids (e.g. `cursor:composer-2.5[fast=true]`) also work. If the user has not specified a model, ask them which model and backend to use.',
		),
	sessionId: z
		.string()
		.optional()
		.describe(
			'Resume a prior session. Pass the sessionId returned from a previous result done response.',
		),
	background: z
		.boolean()
		.optional()
		.describe(
			'When true, return immediately with {status:"running", jobId, waitUrl?} and wait separately. When omitted or false (default), block until the job finishes (up to 30 minutes) and return the final result.',
		),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

export const startTool = {
	inputSchema,
	handle(args: Args, ctx: { jobs: Jobs; waitUrlBase: string | undefined }) {
		const runningResponse = (jobId: string) =>
			ctx.waitUrlBase !== undefined
				? {
						status: 'running' as const,
						jobId,
						waitUrl: `${ctx.waitUrlBase}/jobs/${jobId}/wait`,
					}
				: { status: 'running' as const, jobId };

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
