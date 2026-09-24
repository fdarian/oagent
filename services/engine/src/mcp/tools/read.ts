import { Effect } from 'effect';
import { z } from 'zod';
import {
	formatSessionError,
	formatTurnResult,
} from '../../format/turn-result.ts';
import type { Sessions } from '../../sessions.ts';

const description = `\
Read the latest turn in a session, waiting briefly if it is still running. If it \
remains running, call again later or run \`oagent jobs wait <jobId>\` as a \
background command.`;

const WAIT_TIMEOUT_DEFAULT_MS = 50_000;
const WAIT_TIMEOUT_MAX_MS = 55_000;

export const inputSchema = {
	sessionId: z.string().describe('The sessionId returned by `start`.'),
	timeoutMs: z
		.number()
		.optional()
		.describe('Maximum milliseconds to wait (default 50000, capped at 55000).'),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;
type ReadSessions = Pick<Sessions['Service'], 'read'>;

function textResponse(text: string) {
	return { content: [{ type: 'text' as const, text }] };
}

export const readTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { sessions: ReadSessions }) {
		return ctx.sessions
			.read({
				sessionId: args.sessionId,
				timeoutMs: Math.min(
					args.timeoutMs ?? WAIT_TIMEOUT_DEFAULT_MS,
					WAIT_TIMEOUT_MAX_MS,
				),
			})
			.pipe(
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
					Effect.succeed(
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
