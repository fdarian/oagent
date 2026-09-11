import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Cause, Context, Effect, type Effect as EffectType, Exit, Option } from 'effect';
import type { Jobs } from '../jobs.ts';
import { cancelTool } from './tools/cancel.ts';
import { listTool } from './tools/list.ts';
import { resultTool } from './tools/result.ts';
import { buildDescription, inputSchema, startTool } from './tools/start.ts';

export function registerTools(
	server: McpServer,
	jobs: Jobs['Service'],
	services: Context.Context<never>,
	waitUrlBase: string | undefined,
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

	const registeredStart = server.registerTool(
		'start',
		{ description: buildDescription(jobs.listAliases()), inputSchema },
		(args, extra) =>
			runHandler(
				startTool.handle(args, {
					jobs,
					waitUrlBase,
					mcpSessionId: extra.sessionId,
				}),
			),
	);

	// Refresh aliases on every connect so the description reflects current state per session.
	server.server.oninitialized = () => {
		registeredStart.update({
			description: buildDescription(jobs.listAliases()),
		});
	};

	server.registerTool(
		'result',
		{
			description: resultTool.description,
			inputSchema: resultTool.inputSchema,
		},
		(args) => runHandler(resultTool.handle(args, { jobs })),
	);

	server.registerTool(
		'cancel',
		{
			description: cancelTool.description,
			inputSchema: cancelTool.inputSchema,
		},
		(args) => runHandler(cancelTool.handle(args, { jobs })),
	);

	server.registerTool(
		'list',
		{
			description: listTool.description,
			inputSchema: listTool.inputSchema,
		},
		(args, extra) =>
			runHandler(
				listTool.handle(args, { jobs, mcpSessionId: extra.sessionId }),
			),
	);
}
