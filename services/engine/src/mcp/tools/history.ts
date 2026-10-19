import { Effect } from 'effect';
import { z } from 'zod';
import { formatHistory } from '../../format/history.ts';
import { formatSessionError } from '../../format/turn-result.ts';
import {
	HISTORY_DEFAULT_LIMIT,
	HISTORY_MAX_LIMIT,
	HISTORY_MIN_LIMIT,
} from '../../history/limits.ts';
import type { Sessions } from '../../sessions.ts';

const description = `\
Read a session's past turns: prompts, final answers and tool-call counts, newest page first. Pass jobId to expand one turn into its messages and tool calls, including a running turn's progress.`;

export const inputSchema = z.object({
	sessionId: z.string().describe('The sessionId returned by `start`.'),
	jobId: z
		.string()
		.optional()
		.describe(
			'Expand this turn into its messages and tool calls. Cannot be combined with limit or before.',
		),
	limit: z
		.number()
		.int()
		.min(HISTORY_MIN_LIMIT)
		.max(HISTORY_MAX_LIMIT)
		.optional()
		.describe(
			`How many turns to return, newest first (default ${HISTORY_DEFAULT_LIMIT}, max ${HISTORY_MAX_LIMIT}).`,
		),
	before: z
		.string()
		.optional()
		.describe(
			'Return the turns older than this jobId; use the value the previous page printed.',
		),
});

type Args = z.infer<typeof inputSchema>;
type HistorySessions = Pick<Sessions['Service'], 'history'>;

function textResponse(text: string) {
	return { content: [{ type: 'text' as const, text }] };
}

export const historyTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { sessions: HistorySessions }) {
		return ctx.sessions.history(args).pipe(
			Effect.map((history) => textResponse(formatHistory(history))),
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
