import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Cause, type Effect, Exit, Runtime } from 'effect';
import type { Jobs } from '../jobs.ts';
import { resultTool } from './tools/result.ts';
import { startTool } from './tools/start.ts';

export function registerTools(
	server: McpServer,
	jobs: Jobs,
	rt: Runtime.Runtime<never>,
	waitUrlBase: string | undefined,
): void {
	const runHandler = async <A, E>(
		eff: Effect.Effect<A, E, never>,
	): Promise<A> => {
		const exit = await Runtime.runPromiseExit(rt)(eff);
		if (Exit.isFailure(exit)) {
			const cause = exit.cause;
			if (Cause.isFailType(cause)) {
				throw cause.error instanceof Error
					? cause.error
					: new Error(String(cause.error));
			}
			throw new Error(Cause.pretty(cause));
		}
		return exit.value;
	};

	server.registerTool(
		'start',
		{ description: startTool.description, inputSchema: startTool.inputSchema },
		(args) => runHandler(startTool.handle(args, { jobs, waitUrlBase })),
	);

	server.registerTool(
		'result',
		{
			description: resultTool.description,
			inputSchema: resultTool.inputSchema,
		},
		(args) => runHandler(resultTool.handle(args, { jobs })),
	);
}
