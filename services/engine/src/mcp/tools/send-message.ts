import type { ServerContext } from '@modelcontextprotocol/server';
import { Effect } from 'effect';
import { z } from 'zod';
import {
	formatSessionError,
	formatToolError,
	formatTurnResult,
} from '../../format/turn-result.ts';
import type { Jobs } from '../../jobs.ts';
import { requestLogFields } from '../../request-log.ts';
import type { Sessions } from '../../sessions.ts';
import { waitWithProgress } from '../progress.ts';

const description = `\
Send a message to a session. If a turn is running, the message is queued for \
delivery at the next step boundary; if the session is idle, a new turn starts. \
Use \`background\` only when starting a new turn.`;

export const inputSchema = z.object({
	sessionId: z.string().describe('The sessionId returned by `start`.'),
	prompt: z.string().describe('The instruction to send to the agent.'),
	background: z
		.boolean()
		.optional()
		.describe('When true, return immediately if this starts a new turn.'),
});

type Args = z.infer<typeof inputSchema>;
type SendMessageJobs = Pick<
	Jobs['Service'],
	'subscribe' | 'getJobMetadata' | 'readEventsPage' | 'wait'
>;
type SendMessageSessions = Pick<Sessions['Service'], 'sendMessage'>;

function textResponse(text: string) {
	return { content: [{ type: 'text' as const, text }] };
}

export const sendMessageTool = {
	description,
	inputSchema,
	handle(
		args: Args,
		ctx: {
			jobs: SendMessageJobs;
			sessions: SendMessageSessions;
			mcp?: ServerContext;
		},
	) {
		return ctx.sessions
			.sendMessage({ sessionId: args.sessionId, prompt: args.prompt })
			.pipe(
				Effect.tap((result) =>
					Effect.logInfo(
						`MCP send_message accepted ${requestLogFields({ jobId: result.jobId, sessionId: result.sessionId })}`,
					),
				),
				Effect.flatMap((started) => {
					if (started.delivery === 'steered') {
						return Effect.succeed(
							textResponse(
								formatTurnResult({
									sessionId: started.sessionId,
									jobId: started.jobId,
									result: { status: 'running' },
									steered: true,
								}),
							),
						);
					}
					if (args.background === true) {
						return Effect.succeed(
							textResponse(
								formatTurnResult({
									sessionId: started.sessionId,
									jobId: started.jobId,
									result: { status: 'running' },
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
									formatSessionError(
										args.sessionId,
										error instanceof Error ? error.message : String(error),
									),
								),
							),
				),
			);
	},
};
