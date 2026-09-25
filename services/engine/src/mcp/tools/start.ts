import type { ServerContext } from '@modelcontextprotocol/server';
import { Effect } from 'effect';
import { z } from 'zod';
import type { AgentDefinition } from '../../agents.ts';
import { formatToolError, formatTurnResult } from '../../format/turn-result.ts';
import type { Jobs } from '../../jobs.ts';
import { requestLogFields } from '../../request-log.ts';
import type { Sessions } from '../../sessions.ts';
import { waitWithProgress } from '../progress.ts';

const BASE_DESCRIPTION = `\
Start a coding-agent session or fork an existing session/job. Pass its returned \
session ID to \`send_message\` to continue. Use \`read\` to check a background turn.`;

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

export const inputSchema = z.object({
	prompt: z.string().describe('Task instructions for the agent.'),
	cwd: z
		.string()
		.optional()
		.describe('Absolute working directory; optional when forkId is set.'),
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
	forkId: z
		.string()
		.optional()
		.describe('Session ID or job ID whose state should be forked.'),
	background: z
		.boolean()
		.optional()
		.describe(
			'When true, return immediately with a jobId instead of waiting for the result.',
		),
});

export const worktreeInputSchema = inputSchema.extend({
	worktree: z
		.boolean()
		.optional()
		.describe('Create a fresh worktree for this job.'),
});

type Args = z.infer<typeof worktreeInputSchema>;
type StartJobs = Pick<
	Jobs['Service'],
	'subscribe' | 'getJobMetadata' | 'readEventsPage' | 'wait'
>;
type StartSessions = Pick<Sessions['Service'], 'start'>;

function textResponse(text: string) {
	return { content: [{ type: 'text' as const, text }] };
}

export const startTool = {
	inputSchema,
	handle(
		args: Args,
		ctx: {
			jobs: StartJobs;
			sessions: StartSessions;
			mcp?: ServerContext;
		},
	) {
		return ctx.sessions
			.start({
				prompt: args.prompt,
				cwd: args.cwd,
				model: args.model,
				agentType: args.agent_type,
				forkId: args.forkId,
				worktree: args.worktree,
			})
			.pipe(
				Effect.tap((result) =>
					Effect.logInfo(
						`MCP start accepted ${requestLogFields({ jobId: result.jobId, sessionId: result.sessionId })}`,
					),
				),
				Effect.flatMap((started) => {
					if (args.background === true) {
						return Effect.succeed(
							textResponse(
								formatTurnResult({
									sessionId: started.sessionId,
									jobId: started.jobId,
									result: { status: 'running' },
									worktreePath: started.worktreePath,
									worktreeBranch: started.worktreeBranch,
								}),
							),
						);
					}
					return (
						ctx.mcp === undefined
							? ctx.jobs.wait({ jobId: started.jobId })
							: waitWithProgress(ctx.jobs, started.jobId, ctx.mcp)
					).pipe(
						Effect.map((result) =>
							textResponse(
								formatTurnResult({
									sessionId: started.sessionId,
									jobId: started.jobId,
									result,
									worktreePath: started.worktreePath,
									worktreeBranch: started.worktreeBranch,
								}),
							),
						),
						Effect.catchTag('JobNotFound', (error) =>
							Effect.succeed(textResponse(formatToolError(error.message))),
						),
					);
				}),
				Effect.catch((error) =>
					error instanceof Error && error.name === 'AbortError'
						? Effect.fail(error)
						: Effect.succeed(
								textResponse(
									formatToolError(
										error instanceof Error ? error.message : String(error),
									),
								),
							),
				),
			);
	},
};
