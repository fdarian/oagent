import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
	type AgentDefinition,
	type AliasPreset,
	cancelTool,
	formatCancellation,
	formatMcpInstructions,
	formatSessions,
	formatToolError,
	formatTurnResult,
	listTool,
	readTool,
	sendMessageTool,
	startDescription,
	startInputSchema,
	startWorktreeInputSchema,
} from '@oagent/engine';
import { Effect } from 'effect';
import { waitForChannelJob } from './channel.ts';
import { createEngineClient } from './engine-client.ts';
import { ensureEngine, isConnectionRefused } from './engine-spawn.ts';
import { overlay, resolveAgent, resolveModel } from './ephemeral-config.ts';
import type { Version } from './misc.ts';

function errorMessage(cause: unknown) {
	return cause instanceof Error ? cause.message : String(cause);
}

export function runMcpStdio(params: {
	version: Version;
	engineUrl: string;
	idleExit: string;
	bare: boolean;
	aliases: AliasPreset[];
	agents: AgentDefinition[];
}) {
	return Effect.gen(function* () {
		const client = createEngineClient(params.engineUrl);
		const services = yield* Effect.context<import('effect/Path').Path>();
		const ensure = () =>
			ensureEngine(params.engineUrl, params.idleExit).pipe(
				Effect.provide(services),
			);
		const rpc = <A>(call: () => Promise<A>) =>
			Effect.runPromise(
				Effect.tryPromise({
					try: call,
					catch: (cause) => new Error(errorMessage(cause), { cause }),
				}).pipe(
					Effect.catch((error) =>
						isConnectionRefused(error)
							? ensure().pipe(
									Effect.andThen(
										Effect.tryPromise({
											try: call,
											catch: (cause) =>
												new Error(errorMessage(cause), { cause }),
										}),
									),
								)
							: Effect.fail(error),
					),
				),
			);
		const data = yield* Effect.tryPromise({
			try: () =>
				Promise.all([
					params.bare
						? Promise.resolve(params.aliases)
						: rpc(() => client.aliases.list()).then((rows) =>
								overlay(rows, params.aliases),
							),
					params.bare
						? Promise.resolve(params.agents)
						: rpc(() => client.agents.list()).then((rows) =>
								overlay(rows, params.agents),
							),
					rpc(() => client.settings.getWorktree()),
				]),
			catch: (cause) => new Error(errorMessage(cause), { cause }),
		});
		const aliases = data[0];
		const agents = data[1];
		const worktree = data[2];
		const server = new McpServer(
			{ name: 'oagent', version: params.version },
			{ instructions: formatMcpInstructions(aliases, agents) },
		);
		const text = (value: string) => ({
			content: [{ type: 'text' as const, text: value }],
		});
		const register = <A>(
			name: string,
			tool: { description: string; inputSchema: import('zod').ZodType<A> },
			handle: (args: A, ctx: ServerContext) => Promise<ReturnType<typeof text>>,
		) => {
			server.registerTool(name, tool, async (args, ctx) => {
				try {
					return await handle(args as A, ctx);
				} catch (cause) {
					if (ctx.mcpReq.signal.aborted) throw cause;
					return {
						...text(formatToolError(errorMessage(cause))),
						isError: true,
					};
				}
			});
		};
		const wait = (jobId: string, ctx: ServerContext) =>
			waitForChannelJob(client, params.engineUrl, jobId, ctx);
		register(
			'start',
			{
				description: startDescription(),
				inputSchema:
					worktree.enabled && worktree.createCommand.trim() !== ''
						? startWorktreeInputSchema
						: startInputSchema,
			},
			async (args, ctx) => {
				const model = await Effect.runPromise(
					resolveModel(args.model, params.aliases, params.bare),
				);
				const agent = await Effect.runPromise(
					resolveAgent(args.agent_type, params.agents, params.bare),
				);
				const started = await rpc(() =>
					client.sessions.start({
						...args,
						model,
						...agent,
						agent:
							agent.agent === undefined
								? undefined
								: {
										name: agent.agent.name,
										description: agent.agent.description ?? undefined,
										targets: [...agent.agent.targets],
									},
						worktree: 'worktree' in args && args.worktree === true,
					}),
				);
				return text(
					formatTurnResult({
						...started,
						result: args.background
							? { status: 'running' }
							: await wait(started.jobId, ctx),
					}),
				);
			},
		);
		register('send_message', sendMessageTool, async (args, ctx) => {
			const started = await rpc(() => client.sessions.sendMessage(args));
			return text(
				formatTurnResult({
					...started,
					steered: started.delivery === 'steered',
					result:
						args.background || started.delivery === 'steered'
							? { status: 'running' }
							: await wait(started.jobId, ctx),
				}),
			);
		});
		register('read', readTool, async (args, ctx) => {
			const result = await rpc(() => client.sessions.read(args));
			return text(
				formatTurnResult({
					sessionId: args.sessionId,
					jobId: result.jobId,
					result:
						args.wait && result.status === 'running'
							? await wait(result.jobId, ctx)
							: result,
				}),
			);
		});
		register('cancel', cancelTool, async (args) => {
			const result = await rpc(() => client.sessions.cancel(args));
			return text(
				result.ok
					? formatCancellation({
							sessionId: args.sessionId,
							status: result.status,
						})
					: formatToolError(`Session not found: ${args.sessionId}`),
			);
		});
		register('list', listTool, async (args) =>
			text(formatSessions(await rpc(() => client.sessions.list(args)))),
		);
		yield* Effect.acquireRelease(
			Effect.tryPromise(() => server.connect(new StdioServerTransport())),
			() => Effect.promise(() => server.close()),
		);
		yield* Effect.never;
	}).pipe(Effect.scoped);
}
