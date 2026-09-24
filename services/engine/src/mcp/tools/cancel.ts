import { Effect } from 'effect';
import { z } from 'zod';
import {
	formatCancellation,
	formatSessionError,
} from '../../format/turn-result.ts';
import type { Sessions } from '../../sessions.ts';

const description = `\
Cancel a running turn in a session. If the session is idle, this is a no-op.`;

const inputSchema = {
	sessionId: z.string().describe('The sessionId returned by `start`.'),
};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;
type CancelSessions = Pick<Sessions['Service'], 'cancel'>;

function textResponse(text: string) {
	return { content: [{ type: 'text' as const, text }] };
}

export const cancelTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { sessions: CancelSessions }) {
		return ctx.sessions.cancel(args).pipe(
			Effect.map((result) =>
				textResponse(
					result.ok
						? formatCancellation({
								sessionId: args.sessionId,
								status: result.status,
							})
						: formatSessionError(
								args.sessionId,
								`Session not found: ${args.sessionId}`,
							),
				),
			),
		);
	},
};
