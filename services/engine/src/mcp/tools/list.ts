import { Effect } from 'effect';
import { z } from 'zod';
import { INLINE_ACP_HARNESS_ID } from '../../harness.ts';
import type { Sessions } from '../../sessions.ts';

const description = `\
List recent sessions, including their title, latest job status, prompt, and \
creation time. Pass cwd to limit results to sessions started or working in \
that directory or any directory under it.`;

const inputSchema = z.object({
	cwd: z
		.string()
		.optional()
		.describe('Absolute directory; matches sessions in it or beneath it.'),
});

type Args = z.infer<typeof inputSchema>;
type SessionSummary = {
	id: string;
	title: string;
	jobId: string;
	status: 'running' | 'done' | 'error' | 'cancelled';
	prompt: string;
	cwd: string;
	originCwd: string;
	worktreePath?: string;
	worktreeBranch?: string;
	backend?: string;
	acpCommand?: { binary: string; args: ReadonlyArray<string> };
	createdAt: number;
};
type SessionList = Pick<Sessions['Service'], 'list'>;

export function formatSessions(
	sessions: ReadonlyArray<SessionSummary>,
): string {
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
			const details = [
				`  ${promptSummary}`,
				...(session.originCwd === session.cwd
					? []
					: [`  origin: \`${session.originCwd}\``]),
				...(session.worktreePath === undefined
					? []
					: [`  worktree: \`${session.worktreePath}\``]),
				...(session.worktreeBranch === undefined
					? []
					: [`  branch: \`${session.worktreeBranch}\``]),
				...(session.backend !== INLINE_ACP_HARNESS_ID
					? []
					: [
							`  backend: \`acp\`${
								session.acpCommand === undefined
									? ''
									: ` · \`${[session.acpCommand.binary, ...session.acpCommand.args].join(' ')}\``
							}`,
						]),
			];
			return `- **${session.title}** (\`${session.id}\`) [${session.status}] ${created} · latest job \`${session.jobId}\`\n${details.join('\n')}`;
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
