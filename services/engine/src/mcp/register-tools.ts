import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Cause, type Effect, Exit, Runtime } from 'effect';
import type { Jobs } from '../jobs.ts';
import { cancelTool } from './tools/cancel.ts';
import { resultTool } from './tools/result.ts';
import { buildDescription, inputSchema, startTool } from './tools/start.ts';

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

	const registeredStart = server.registerTool(
		'start',
		{ description: buildDescription(jobs.listAliases()), inputSchema },
		(args) => runHandler(startTool.handle(args, { jobs, waitUrlBase })),
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
}
