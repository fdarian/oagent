import { Effect } from 'effect';
import { z } from 'zod';
import type { Sessions } from '../../sessions.ts';

const description = `\
List recent sessions, including their title, latest job status, prompt, and \
creation time. Pass cwd to limit results to that working directory.`;

const inputSchema = z.object({
	cwd: z
		.string()
		.optional()
		.describe('Absolute working directory to filter sessions.'),
});

type Args = z.infer<typeof inputSchema>;
type SessionSummary = {
	id: string;
	title: string;
	jobId: string;
	status: 'running' | 'done' | 'error' | 'cancelled';
	prompt: string;
	createdAt: number;
};
type SessionList = Pick<Sessions['Service'], 'list'>;

function formatSessions(sessions: ReadonlyArray<SessionSummary>): string {
	if (sessions.length === 0) {
		return 'No sessions found.';
	}
	const lines = [
		`# Sessions (${sessions.length})`,
		'',
		...sessions.map((session) => {
			const oneLine = session.prompt.replace(/\n/g, ' ');
			const promptSummary =
				oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
			const created = new Date(session.createdAt).toISOString();
			return `- **${session.title}** (\`${session.id}\`) [${session.status}] ${created} · latest job \`${session.jobId}\`\n  ${promptSummary}`;
		}),
	];
	return lines.join('\n');
}

export const listTool = {
	description,
	inputSchema,
	handle(args: Args, ctx: { sessions: SessionList }) {
		return ctx.sessions.list({ cwd: args.cwd }).pipe(
			Effect.map((sessions) => ({
				content: [{ type: 'text' as const, text: formatSessions(sessions) }],
			})),
		);
	},
};
