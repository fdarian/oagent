/// <reference types="bun" />
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Context, Effect, Layer, Schema } from 'effect';
import { Agents } from './agents.ts';
import { loadConfig } from './config.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { Harnesses } from './harnesses.ts';
import { handleJobsStream } from './http/jobs-stream.ts';
import { serveSPA } from './http/spa.ts';
import { handleJobEvents } from './http/sse.ts';
import { handleJobWait } from './http/wait.ts';
import { Jobs } from './jobs.ts';
import { registerTools } from './mcp/register-tools.ts';
import { formatMcpInstructions } from './mcp/tools/start.ts';
import { createEngineHandler } from './rpc/handler.ts';
import type { EngineServices } from './rpc/router.ts';
import { Sessions } from './sessions.ts';
import { Settings } from './settings.ts';
import { SideChats } from './side-chats.ts';

const PORTLESS_ALIAS = 'oagent';
const PORTLESS_PUBLIC_BASE = `https://${PORTLESS_ALIAS}.localhost`;

class PortlessRegistrationError extends Schema.TaggedError<PortlessRegistrationError>()(
	'PortlessRegistrationError',
	{ cause: Schema.Defect() },
) {
	override get message() {
		return String(this.cause);
	}
}

type ServerOptions = {
	port: number;
	serverInfo: { name: string; version: string };
	filemap?: Record<string, string>;
	portless?: boolean;
};

export class Engine extends Context.Service<Engine>()('engine', {
	make: Effect.gen(function* () {
		const jobs = yield* Jobs;
		const sessionService = yield* Sessions;
		const settings = yield* Settings;
		const agents = yield* Agents;
		const harnesses = yield* Harnesses;
		const engineHandler = yield* createEngineHandler;
		const services = yield* Effect.context<EngineServices>();
		const getMcpInstructions = () =>
			formatMcpInstructions(jobs.listAliases(), agents.list());
		yield* Effect.forkDetach(
			harnesses
				.refresh()
				.pipe(
					Effect.catchTag('HarnessesError', (error) =>
						Effect.logWarning(`harness detection failed: ${error.message}`),
					),
				),
		);

		return {
			mcp: {
				getInstructions: getMcpInstructions,
				registerTools: (server: McpServer, services: Context.Context<never>) =>
					registerTools(server, jobs, sessionService, settings, services),
			},
			startServer: ({ port, serverInfo, filemap, portless }: ServerOptions) =>
				Effect.gen(function* () {
					const jobs = yield* Jobs;

					const resolvedPort =
						process.env.OPENCODE_MCP_PORT !== undefined
							? Number.parseInt(process.env.OPENCODE_MCP_PORT, 10)
							: port;

					/** Map of MCP session ID → { transport, server } */
					const sessions = new Map<
						string,
						{
							transport: WebStandardStreamableHTTPServerTransport;
							server: McpServer;
						}
					>();

					const fetchHandler = async (request: Request) => {
						const url = new URL(request.url);

						// 1. MCP endpoint
						if (url.pathname === '/mcp') {
							const sessionId = request.headers.get('mcp-session-id');

							if (sessionId !== null) {
								const session = sessions.get(sessionId);
								if (session === undefined) {
									return new Response('Session not found', { status: 404 });
								}
								return session.transport.handleRequest(request);
							}

							const transport = new WebStandardStreamableHTTPServerTransport({
								sessionIdGenerator: () => randomUUID(),
								onsessioninitialized: (sid) => {
									sessions.set(sid, { transport, server: mcpServer });
								},
								onsessionclosed: (sid) => {
									sessions.delete(sid);
								},
							});

							const mcpServer = new McpServer(
								{ name: serverInfo.name, version: serverInfo.version },
								{
									capabilities: { tools: {} },
									instructions: getMcpInstructions(),
								},
							);
							registerTools(
								mcpServer,
								jobs,
								sessionService,
								settings,
								services,
							);

							await mcpServer.connect(transport);
							return transport.handleRequest(request);
						}

						// 2. oRPC endpoint
						if (url.pathname === '/rpc' || url.pathname.startsWith('/rpc/')) {
							const result = await engineHandler.handle(request, {
								prefix: '/rpc',
								context: { 'effect/context': services },
							});
							if (result.matched) {
								return result.response;
							}
						}

						// 3. Global jobs SSE stream
						if (url.pathname === '/jobs/events')
							return handleJobsStream(jobs, request.signal);

						// 4. Per-job SSE events endpoint
						const eventsJobId = url.pathname.match(
							/^\/jobs\/([^/]+)\/events$/,
						)?.[1];
						if (eventsJobId !== undefined)
							return handleJobEvents(jobs, eventsJobId, request.signal);

						// 5. Wait endpoint
						const waitJobId = url.pathname.match(
							/^\/jobs\/([^/]+)\/wait$/,
						)?.[1];
						if (waitJobId !== undefined) {
							const timeoutParam = url.searchParams.get('timeoutMs');
							const timeoutMs =
								timeoutParam !== null
									? Number.parseInt(timeoutParam, 10)
									: 600_000;
							return handleJobWait(jobs, waitJobId, timeoutMs, services);
						}

						// 6. SPA fallback
						if (filemap !== undefined) {
							const spaResponse = serveSPA(filemap, url.pathname);
							if (spaResponse !== undefined) return spaResponse;
						}

						return new Response('Not Found', { status: 404 });
					};

					function tryBind(targetPort: number) {
						try {
							return {
								server: Bun.serve({
									hostname: '127.0.0.1',
									port: targetPort,
									idleTimeout: 0,
									fetch: fetchHandler,
								}),
								didFallback: false,
							};
						} catch (cause) {
							const msg =
								cause instanceof Error ? cause.message : String(cause);
							const code =
								cause instanceof Error
									? (cause as { code?: string }).code
									: undefined;
							if (
								code === 'EADDRINUSE' ||
								msg.includes('EADDRINUSE') ||
								msg.includes('address already in use')
							) {
								return {
									server: Bun.serve({
										hostname: '127.0.0.1',
										port: 0,
										idleTimeout: 0,
										fetch: fetchHandler,
									}),
									didFallback: true,
								};
							}
							throw cause;
						}
					}

					const bindResult = yield* Effect.try({
						try: () => tryBind(resolvedPort),
						catch: (cause) =>
							new Error(
								`Failed to start HTTP server on port ${resolvedPort}: ${cause instanceof Error ? cause.message : String(cause)}`,
							),
					});

					if (bindResult.didFallback) {
						yield* Effect.logWarning(
							`port ${resolvedPort} in use, falling back to a free port`,
						);
					}

					yield* Effect.logInfo(
						`oagent listening on http://127.0.0.1:${bindResult.server.port}/mcp`,
					);

					const fileConfig = yield* loadConfig();
					const portlessEnabled =
						portless === true || fileConfig.portless === true;

					if (portlessEnabled) {
						const portlessBin = Bun.which('portless');
						if (portlessBin == null) {
							yield* Effect.logWarning(
								'portless registration failed — `portless` not found in PATH',
							);
						} else {
							const exitCode = yield* Effect.tryPromise({
								try: () =>
									Bun.spawn(
										[
											portlessBin,
											'alias',
											PORTLESS_ALIAS,
											String(bindResult.server.port),
										],
										{ stdout: 'pipe', stderr: 'pipe' },
									).exited,
								catch: (cause) => new PortlessRegistrationError({ cause }),
							});
							if (exitCode === 0) {
								process.on('exit', () => {
									Bun.spawnSync([
										portlessBin,
										'alias',
										'--remove',
										PORTLESS_ALIAS,
									]);
								});
								yield* Effect.logInfo(
									`oagent accessible at ${PORTLESS_PUBLIC_BASE}`,
								);
							} else {
								yield* Effect.logWarning(
									`portless registration failed — run \`portless proxy start\` first for ${PORTLESS_PUBLIC_BASE} access`,
								);
							}
						}
					}

					yield* Effect.never;
				}).pipe(Effect.provideService(Jobs, jobs)),
		};
	}),
}) {
	static readonly layer = Layer.effect(Engine, Engine.make).pipe(
		Layer.provide(Jobs.layer),
		Layer.provide(Sessions.layer),
		Layer.provide(SideChats.layer),
		Layer.provide(Harnesses.layer),
		Layer.provide(HarnessRegistry.layer),
		Layer.provide(Settings.layer),
		Layer.provide(Agents.layer),
	);
}
