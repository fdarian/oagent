import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
	Cause,
	type Context,
	Effect,
	type Effect as EffectType,
	Exit,
	Option,
} from 'effect';
import type { Jobs } from '../jobs.ts';
import type { Sessions } from '../sessions.ts';
import type { Settings } from '../settings.ts';
import { cancelTool } from './tools/cancel.ts';
import { listTool } from './tools/list.ts';
import { readTool } from './tools/read.ts';
import { sendMessageTool } from './tools/send-message.ts';
import {
	buildDescription,
	inputSchema,
	startTool,
	worktreeInputSchema,
} from './tools/start.ts';

export function registerTools(
	server: McpServer,
	jobs: Jobs['Service'],
	sessions: Sessions['Service'],
	settings: Settings['Service'],
	services: Context.Context<never>,
): void {
	const runHandler = async <A, E>(
		eff: EffectType.Effect<A, E, never>,
	): Promise<A> => {
		const exit = await Effect.runPromiseExitWith(services)(eff);
		if (Exit.isFailure(exit)) {
			const errorOption = Cause.findErrorOption(exit.cause);
			if (Option.isSome(errorOption)) {
				throw errorOption.value instanceof Error
					? errorOption.value
					: new Error(String(errorOption.value));
			}
			throw new Error(Cause.pretty(exit.cause));
		}
		return exit.value;
	};

	const worktree = settings.getWorktree();
	server.registerTool(
		'start',
		{
			description: buildDescription(),
			inputSchema:
				worktree.enabled && worktree.createCommand.trim() !== ''
					? worktreeInputSchema
					: inputSchema,
		},
		(args, extra) =>
			runHandler(
				startTool.handle(args, {
					jobs,
					sessions,
					mcpSessionId: extra.sessionId,
				}),
			),
	);

	server.registerTool(
		'read',
		{
			description: readTool.description,
			inputSchema: readTool.inputSchema,
		},
		(args) => runHandler(readTool.handle(args, { sessions })),
	);

	server.registerTool(
		'cancel',
		{
			description: cancelTool.description,
			inputSchema: cancelTool.inputSchema,
		},
		(args) => runHandler(cancelTool.handle(args, { sessions })),
	);

	server.registerTool(
		'send_message',
		{
			description: sendMessageTool.description,
			inputSchema: sendMessageTool.inputSchema,
		},
		(args) => runHandler(sendMessageTool.handle(args, { jobs, sessions })),
	);

	server.registerTool(
		'list',
		{
			description: listTool.description,
			inputSchema: listTool.inputSchema,
		},
		(args, extra) =>
			runHandler(
				listTool.handle(args, { sessions, mcpSessionId: extra.sessionId }),
			),
	);
}
