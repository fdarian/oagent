import { Effect } from 'effect';
import type { z } from 'zod';
import type { Sessions } from '../../sessions.ts';

const description = `\
List sessions started in the current MCP session, including their latest job \
status, prompt, and creation time. Only available over the HTTP \`/mcp\` transport.`;

const inputSchema = {};

type Args = z.infer<ReturnType<typeof z.object<typeof inputSchema>>>;
type SessionSummary = {
	id: string;
	jobId: string;
	status: 'running' | 'done' | 'error' | 'cancelled';
	prompt: string;
	createdAt: number;
};
type SessionList = Pick<Sessions['Service'], 'list'>;

function formatSessions(sessions: ReadonlyArray<SessionSummary>): string {
	if (sessions.length === 0) {
		return 'No sessions in this MCP session yet.';
	}
	const lines = [
		`# Sessions (${sessions.length})`,
		'',
		...sessions.map((session) => {
			const oneLine = session.prompt.replace(/\n/g, ' ');
			const promptSummary =
				oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
			const created = new Date(session.createdAt).toISOString();
			return `- **${session.id}** [${session.status}] ${created} · latest job \`${session.jobId}\`\n  ${promptSummary}`;
		}),
	];
	return lines.join('\n');
}

export const listTool = {
	description,
	inputSchema,
	handle(
		_args: Args,
		ctx: { sessions: SessionList; mcpSessionId: string | undefined },
	) {
		const sessionId = ctx.mcpSessionId;
		if (sessionId === undefined) {
			return Effect.fail(
				new Error(
					'The `list` tool requires an MCP session. It is only available in /mcp HTTP mode.',
				),
			);
		}
		return ctx.sessions.list({ mcpSessionId: sessionId }).pipe(
			Effect.map((sessions) => ({
				content: [{ type: 'text' as const, text: formatSessions(sessions) }],
			})),
		);
	},
};
