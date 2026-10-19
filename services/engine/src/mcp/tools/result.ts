import type { ServerContext } from '@modelcontextprotocol/server';
import { Effect } from 'effect';
import { z } from 'zod';
import {
	formatSessionError,
	formatTurnResult,
} from '../../format/turn-result.ts';
import type { Jobs } from '../../jobs.ts';
import type { Sessions } from '../../sessions.ts';
import { waitWithProgress } from '../progress.ts';

const description = `\
Get the latest turn's result in a session. Set wait to block until it finishes. For earlier turns or what the agent did, use history.`;

export const inputSchema = z.object({
	sessionId: z.string().describe('The sessionId returned by `start`.'),
	wait: z.boolean().optional().describe('Wait until the latest turn finishes.'),
});

type Args = z.infer<typeof inputSchema>;
type ResultSessions = Pick<Sessions['Service'], 'result'>;

function textResponse(text: string) {
	return { content: [{ type: 'text' as const, text }] };
}

export const resultTool = {
	description,
	inputSchema,
	handle(
		args: Args,
		ctx: {
			sessions: ResultSessions;
			jobs: Pick<
				Jobs['Service'],
				'subscribe' | 'getJobMetadata' | 'readEventsPage' | 'wait'
			>;
			mcp: ServerContext;
		},
	) {
		return ctx.sessions.result({ sessionId: args.sessionId }).pipe(
			Effect.flatMap((result) =>
				args.wait === true && result.status === 'running'
					? waitWithProgress(ctx.jobs, result.jobId, ctx.mcp).pipe(
							Effect.map((terminal) => ({ ...terminal, jobId: result.jobId })),
						)
					: Effect.succeed(result),
			),
			Effect.map((result) =>
				textResponse(
					formatTurnResult({
						sessionId: args.sessionId,
						jobId: result.jobId,
						result,
					}),
				),
			),
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
