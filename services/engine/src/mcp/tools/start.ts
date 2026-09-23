import { Effect } from 'effect';
import { z } from 'zod';
import type { AgentDefinition } from '../../agents.ts';
import type { Jobs } from '../../jobs.ts';
import { requestLogFields } from '../../request-log.ts';
import type { Sessions } from '../../sessions.ts';

const BASE_DESCRIPTION = `\
Launch or continue a coding-agent session and return its result. If it returns \
\`{ status: "running", jobId }\`, run \`oagent jobs wait <jobId>\` as a \
background command or use the \`result\` tool; pass a returned \`sessionId\` to \
a later call to resume the session.`;

export type AliasPreset = {
	name: string;
	backend: string;
	model_id: string;
	reasoning_effort?: string | null;
	description?: string | null;
};

export type AgentTypePreset = {
	name: string;
	description?: string | null;
};

/** Renders the preset/alias suffix used by the Claude channel start description. */
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
			a.description !== undefined &&
			a.description !== null &&
			a.description !== ''
				? ` — ${a.description}`
				: '';
		return `  - \`${padded}\` → ${a.backend}:${a.model_id}${reasoningSuffix}${desc}`;
	});

	return `

Available presets (use as \`model\` or pass the raw \`<backend>:<modelId>\` form):
${lines.join('\n')}`;
}

function formatAliasInstructions(aliases: AliasPreset[]): string | undefined {
	if (aliases.length === 0) return undefined;

	const lines = aliases.map((alias) => {
		const description =
			alias.description !== undefined &&
			alias.description !== null &&
			alias.description !== ''
				? ` — ${alias.description}`
				: '';
		return `- ${alias.name}: ${alias.backend}:${alias.model_id}${description}`;
	});
	return `Available model aliases for the \`start\` tool:\n${lines.join('\n')}`;
}

export function formatAgentTypes(
	agentTypes: ReadonlyArray<AgentTypePreset>,
): string {
	if (agentTypes.length === 0) {
		return `

Configured agent types: none.`;
	}

	const lines = agentTypes.map((agentType) => {
		const description =
			agentType.description !== undefined &&
			agentType.description !== null &&
			agentType.description !== ''
				? ` — ${agentType.description}`
				: '';
		return `  - \`${agentType.name}\`${description}`;
	});
	return `

Configured agent types (use as \`agent_type\`):
${lines.join('\n')}`;
}

export function formatAgentTypeInstructions(
	agentTypes: ReadonlyArray<AgentDefinition>,
): string | undefined {
	if (agentTypes.length === 0) return undefined;

	const lines = agentTypes.map((agentType) => {
		const mappings =
			agentType.targets.length === 0
				? 'no harness targets configured'
				: agentType.targets
						.map((target) => `${target.backend}:${target.target}`)
						.join(', ');
		const description =
			agentType.description !== undefined &&
			agentType.description !== null &&
			agentType.description !== ''
				? ` — ${agentType.description}`
				: '';
		return `- ${agentType.name}: ${mappings}${description}`;
	});
	return `Available agent types for the \`start\` tool:\n${lines.join('\n')}`;
}

export function formatMcpInstructions(
	aliases: AliasPreset[],
	agentTypes: ReadonlyArray<AgentDefinition>,
): string | undefined {
	const sections: Array<string> = [];
	const aliasInstructions = formatAliasInstructions(aliases);
	if (aliasInstructions !== undefined) sections.push(aliasInstructions);
	const agentTypeInstructions = formatAgentTypeInstructions(agentTypes);
	if (agentTypeInstructions !== undefined) {
		sections.push(agentTypeInstructions);
	}
	return sections.length === 0 ? undefined : sections.join('\n\n');
}

export function buildDescription(): string {
	return BASE_DESCRIPTION;
}

export const inputSchema = {
	prompt: z.string().describe('Task instructions for the agent.'),
	cwd: z.string().describe('Absolute working directory for the agent.'),
	model: z
		.string()
		.optional()
		.describe(
			'Pick a model alias from the server instructions, or pass a raw `<backend>:<modelId>` value.',
		),
	agent_type: z
		.string()
		.optional()
		.describe('Optional configured agent type from the server instructions.'),
	sessionId: z
		.string()
		.optional()
		.describe(
			'Session ID from a previous `start` result to resume that session.',
		),
	background: z
		.boolean()
		.optional()
		.describe(
			'When true, return immediately with a jobId instead of waiting for the result.',
		),
};

export const worktreeInputSchema = {
	...inputSchema,
	worktree: z
		.boolean()
		.optional()
		.describe('Create a fresh worktree for this job.'),
};

type Args = z.infer<ReturnType<typeof z.object<typeof worktreeInputSchema>>>;
type StartJobs = Pick<Jobs['Service'], 'getStartTimeoutMs' | 'wait'>;
type StartSessions = Pick<Sessions['Service'], 'sendMessage' | 'start'>;

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
			jobs: StartJobs;
			sessions: StartSessions;
			waitUrlBase: string | undefined;
			mcpSessionId: string | undefined;
		},
	) {
		const runningResponse = (jobId: string) => ({
			status: 'running' as const,
			jobId,
		});
		const timeoutMs = ctx.jobs.getStartTimeoutMs();

		const started: Effect.Effect<
			{
				sessionId: string;
				jobId: string;
				delivery: 'started' | 'steered';
				worktreePath?: string;
				worktreeBranch?: string;
			},
			Error,
			never
		> =
			args.sessionId === undefined
				? ctx.sessions
						.start({
							prompt: args.prompt,
							cwd: args.cwd,
							model: args.model,
							agentType: args.agent_type,
							mcpSessionId: ctx.mcpSessionId,
							worktree: args.worktree,
						})
						.pipe(
							Effect.map((result) => ({
								...result,
								delivery: 'started' as const,
							})),
						)
				: ctx.sessions.sendMessage({
						sessionId: args.sessionId,
						prompt: args.prompt,
					});
		return started.pipe(
			Effect.tap((result) =>
				Effect.logInfo(
					`MCP start accepted ${requestLogFields({ jobId: result.jobId, sessionId: result.sessionId })}`,
				),
			),
			Effect.flatMap((result) => {
				const worktree =
					result.worktreePath === undefined
						? {}
						: {
								worktreePath: result.worktreePath,
								worktreeBranch: result.worktreeBranch,
							};
				if (result.delivery === 'steered' || args.background === true) {
					return Effect.succeed({
						...runningResponse(result.jobId),
						sessionId: result.sessionId,
						...(result.delivery === 'steered'
							? {
									message:
										'Message queued for delivery at the next step boundary.',
								}
							: {}),
						...worktree,
					});
				}
				return ctx.jobs
					.wait({
						jobId: result.jobId,
						timeoutMs,
					})
					.pipe(
						Effect.map((wait) =>
							wait.status === 'running'
								? {
										...runningResponse(result.jobId),
										sessionId: result.sessionId,
										...worktree,
									}
								: { ...wait, sessionId: result.sessionId, ...worktree },
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
			Effect.catch((error) =>
				Effect.succeed(errorResponse(error.name, error.message)),
			),
		);
	},
};
