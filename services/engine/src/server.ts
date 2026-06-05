/// <reference types="bun" />
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Console, Effect, Layer, type Runtime, Schema } from 'effect';
import { handleJobsStream } from './http/jobs-stream.ts';
import { serveSPA } from './http/spa.ts';
import { handleJobEvents } from './http/sse.ts';
import { handleJobWait } from './http/wait.ts';
import { Jobs } from './jobs.ts';
import { registerTools } from './mcp/register-tools.ts';
import { ModelCatalog } from './model-catalog.ts';
import { createEngineHandler } from './rpc/handler.ts';

const PORTLESS_ALIAS = 'oagent';
const PORTLESS_PUBLIC_BASE = `https://${PORTLESS_ALIAS}.localhost`;

class PortlessRegistrationError extends Schema.TaggedError<PortlessRegistrationError>()(
	'PortlessRegistrationError',
	{ cause: Schema.Defect },
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

export class Engine extends Effect.Service<Engine>()('engine', {
	effect: Effect.gen(function* () {
		const jobs = yield* Jobs;
		const engineHandler = yield* createEngineHandler;

		return {
			mcp: {
				registerTools: (
					server: McpServer,
					rt: Runtime.Runtime<never>,
					waitUrlBase: string | undefined,
				) => registerTools(server, jobs, rt, waitUrlBase),
			},
			startServer: ({ port, serverInfo, filemap, portless }: ServerOptions) =>
				Effect.gen(function* () {
					const jobs = yield* Jobs;
					const rt = yield* Effect.runtime<never>();

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

					let portlessPublicBase: string | undefined;

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
								{ capabilities: { tools: {} } },
							);
							registerTools(
								mcpServer,
								jobs,
								rt,
								portlessPublicBase ?? url.origin,
							);

							await mcpServer.connect(transport);
							return transport.handleRequest(request);
						}

						// 2. oRPC endpoint
						if (url.pathname === '/rpc' || url.pathname.startsWith('/rpc/')) {
							const result = await engineHandler.handle(request, {
								prefix: '/rpc',
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
							return handleJobWait(jobs, waitJobId, timeoutMs, rt);
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
						console.warn(
							`port ${resolvedPort} in use, falling back to a free port`,
						);
					}

					yield* Console.error(
						`oagent listening on http://127.0.0.1:${bindResult.server.port}/mcp`,
					);

					if (portless === true) {
						const portlessBin = Bun.which('portless');
						if (portlessBin == null) {
							yield* Console.warn(
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
								portlessPublicBase = PORTLESS_PUBLIC_BASE;
								process.on('exit', () => {
									Bun.spawnSync([
										portlessBin,
										'alias',
										'--remove',
										PORTLESS_ALIAS,
									]);
								});
								yield* Console.error(
									`oagent accessible at ${PORTLESS_PUBLIC_BASE}`,
								);
							} else {
								yield* Console.warn(
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
	static layer = Engine.Default.pipe(
		Layer.provide(Jobs.Default),
		Layer.provide(ModelCatalog.Default),
		Layer.provide(Layer.scope),
	);
}
