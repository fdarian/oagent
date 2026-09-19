import { Effect } from 'effect';
import { z } from 'zod';
import type { Jobs } from '../../jobs.ts';

const BASE_DESCRIPTION = `\
Launch or continue an agent.

It returns the final result as a discriminated union:
- Success: \`{ status: "done", text, sessionId, stopReason }\` — the final aggregated assistant text plus the \`sessionId\` you can pass back into a subsequent \`start\` call to continue the same conversation
- Error: \`{ status: "error", message, sessionId? }\` — the job terminated with an error; \
  \`sessionId\` is included when the harness created a session before the error
- Cancelled: \`{ status: "cancelled", sessionId? }\` — \`sessionId\` is included when the \
  harness created a session before cancellation
- Pending: \`{ status: "running", jobId }\` — the job is still running. Wait by running \`oagent jobs wait <jobId>\` verbatim as a background command (it can block for many minutes). Do NOT pipe, redirect, or wrap it (no \`| tail\`, \`2>&1\`, \`echo $?\`, etc.) — it prints exactly one JSON result line to stdout that you read directly.

If this tool timed-out, you can find the jobId from \`oagent jobs list\``;

export type AliasPreset = {
	name: string;
	backend: string;
	model_id: string;
	reasoning_effort?: string | null;
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
		const reasoningSuffix =
			a.reasoning_effort !== undefined &&
			a.reasoning_effort !== null &&
			a.reasoning_effort !== ''
				? `[${a.reasoning_effort}]`
				: '';
		const desc =
			a.description !== null && a.description !== ''
				? ` — ${a.description}`
				: '';
		return `  - \`${padded}\` → ${a.backend}:${a.model_id}${reasoningSuffix}${desc}`;
	});

	return `

Available presets (use as \`model\` or pass the raw \`<backend>:<modelId>\` form):
${lines.join('\n')}`;
}

export function formatAgentTypes(agentTypes: ReadonlyArray<string>): string {
	if (agentTypes.length === 0) {
		return `

Configured agent types: none.`;
	}

	const lines = agentTypes.map((name) => `  - \`${name}\``);
	return `

Configured agent types (use as \`agent_type\`):
${lines.join('\n')}`;
}

export function buildDescription(
	aliases: AliasPreset[],
	agentTypes: ReadonlyArray<string>,
): string {
	return `${BASE_DESCRIPTION}${formatPresets(aliases)}${formatAgentTypes(agentTypes)}`;
}

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
	agent_type: z
		.string()
		.optional()
		.describe(
			'Configured agent type to run. Available agent types are listed in this tool description.',
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
			'`false` (default), block until the job finishes (up to the configured timeout) and return the final result; When `true`, return immediately with `{ status:"running", jobId }`',
		),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;

function errorResponse(code: string, message: string) {
	return {
		content: [
			{
				type: 'text' as const,
				text: JSON.stringify({ error: { code, message } }),
			},
		],
	};
}

export const startTool = {
	inputSchema,
	handle(
		args: Args,
		ctx: {
			jobs: Jobs['Service'];
			waitUrlBase: string | undefined;
			mcpSessionId: string | undefined;
		},
	) {
		const runningResponse = (jobId: string) => ({
			status: 'running' as const,
			jobId,
		});
		const timeoutMs = ctx.jobs.getStartTimeoutMs();

		return ctx.jobs
			.start({
				prompt: args.prompt,
				cwd: args.cwd,
				model: args.model,
				agentType: args.agent_type,
				sessionId: args.sessionId,
				mcpSessionId: ctx.mcpSessionId,
			})
			.pipe(
				Effect.flatMap((result) => {
					if (args.background === true) {
						return Effect.succeed(runningResponse(result.jobId));
					}
					return ctx.jobs
						.wait({
							jobId: result.jobId,
							timeoutMs,
						})
						.pipe(
							Effect.map((wait) =>
								wait.status === 'running'
									? runningResponse(result.jobId)
									: wait,
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
					Effect.succeed(errorResponse(err.code, err.message)),
				),
				Effect.catchTag('AgentTypeNotFound', (err) =>
					Effect.succeed(errorResponse(err._tag, err.message)),
				),
				Effect.catchTag('AgentNotMappedForBackend', (err) =>
					Effect.succeed(errorResponse(err._tag, err.message)),
				),
			);
	},
};
