/// <reference types="bun" />
import { randomUUID } from 'node:crypto';
import {
	HttpApiBuilder,
	HttpRouter,
	HttpServer,
	HttpServerRequest,
	HttpServerResponse,
} from '@effect/platform';
import { BunHttpServer } from '@effect/platform-bun';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
	Cause,
	Console,
	Effect,
	Layer,
	Ref,
	type Runtime,
	Schema,
} from 'effect';
import { EngineApi } from './http/api.ts';
import {
	aliasesGroupLayer,
	jobsGroupLayer,
	modelsGroupLayer,
} from './http/api-handlers.ts';
import { handleJobsStream } from './http/jobs-stream.ts';
import { serveSPA } from './http/spa.ts';
import { handleJobEvents } from './http/sse.ts';
import { handleJobWait } from './http/wait.ts';
import { Jobs } from './jobs.ts';
import { registerTools } from './mcp/register-tools.ts';
import { ModelCatalog } from './model-catalog.ts';

const PORTLESS_ALIAS = 'oagent';
const PORTLESS_PUBLIC_BASE = `https://${PORTLESS_ALIAS}.localhost`;
const WAIT_TIMEOUT_DEFAULT_MS = 600_000;

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

type McpSession = {
	transport: WebStandardStreamableHTTPServerTransport;
	server: McpServer;
};

function makeServerLayer(resolvedPort: number) {
	const preferred = BunHttpServer.layer({
		hostname: '127.0.0.1',
		port: resolvedPort,
		idleTimeout: 0,
	});
	const fallback = BunHttpServer.layer({
		hostname: '127.0.0.1',
		port: 0,
		idleTimeout: 0,
	});
	return preferred.pipe(
		Layer.catchAllCause((cause) => {
			const text = Cause.pretty(cause);
			const isAddrInUse =
				text.includes('EADDRINUSE') ||
				text.includes('address already in use') ||
				Cause.prettyErrors(cause).some(
					(e) => (e as { code?: string }).code === 'EADDRINUSE',
				);
			return isAddrInUse ? Layer.fresh(fallback) : Layer.failCause(cause);
		}),
	);
}

function registerPortless(
	boundPort: number,
	portlessPublicBaseRef: Ref.Ref<string | undefined>,
) {
	return Effect.gen(function* () {
		const portlessBin = Bun.which('portless');
		if (portlessBin == null) {
			yield* Console.warn(
				'portless registration failed — `portless` not found in PATH',
			);
			return;
		}
		const exitCode = yield* Effect.tryPromise({
			try: () =>
				Bun.spawn([portlessBin, 'alias', PORTLESS_ALIAS, String(boundPort)], {
					stdout: 'pipe',
					stderr: 'pipe',
				}).exited,
			catch: (cause) => new PortlessRegistrationError({ cause }),
		});
		if (exitCode === 0) {
			yield* Ref.set(portlessPublicBaseRef, PORTLESS_PUBLIC_BASE);
			process.on('exit', () => {
				Bun.spawnSync([portlessBin, 'alias', '--remove', PORTLESS_ALIAS]);
			});
			yield* Console.error(`oagent accessible at ${PORTLESS_PUBLIC_BASE}`);
			return;
		}
		yield* Console.warn(
			`portless registration failed — run \`portless proxy start\` first for ${PORTLESS_PUBLIC_BASE} access`,
		);
	});
}

function logStartup(
	resolvedPort: number,
	portless: boolean,
	portlessPublicBaseRef: Ref.Ref<string | undefined>,
) {
	return HttpServer.addressWith((addr) =>
		Effect.gen(function* () {
			const boundPort = addr._tag === 'TcpAddress' ? addr.port : 0;
			if (boundPort !== resolvedPort) {
				yield* Console.warn(
					`port ${resolvedPort} in use, falling back to a free port`,
				);
			}
			yield* Console.error(
				`oagent listening on http://127.0.0.1:${boundPort}/mcp`,
			);
			if (portless === true) {
				yield* registerPortless(boundPort, portlessPublicBaseRef);
			}
		}),
	);
}

function makeCustomRoutesLayer(options: {
	jobs: Jobs;
	rt: Runtime.Runtime<never>;
	serverInfo: { name: string; version: string };
	filemap: Record<string, string> | undefined;
	portlessPublicBaseRef: Ref.Ref<string | undefined>;
}) {
	return HttpApiBuilder.Router.use((router) =>
		Effect.gen(function* () {
			const sessions = new Map<string, McpSession>();

			yield* router.all(
				'/mcp',
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest;
					const webRequest = yield* HttpServerRequest.toWeb(request);
					const url = new URL(webRequest.url);
					const portlessBase = yield* Ref.get(options.portlessPublicBaseRef);
					const publicBase = portlessBase ?? url.origin;
					const sessionId = webRequest.headers.get('mcp-session-id');

					if (sessionId !== null) {
						const session = sessions.get(sessionId);
						if (session === undefined) {
							return HttpServerResponse.fromWeb(
								new Response('Session not found', { status: 404 }),
							);
						}
						const response = yield* Effect.promise(() =>
							session.transport.handleRequest(webRequest),
						);
						return HttpServerResponse.fromWeb(response);
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
						{
							name: options.serverInfo.name,
							version: options.serverInfo.version,
						},
						{ capabilities: { tools: {} } },
					);
					registerTools(mcpServer, options.jobs, options.rt, publicBase);

					yield* Effect.promise(() => mcpServer.connect(transport));
					const response = yield* Effect.promise(() =>
						transport.handleRequest(webRequest),
					);
					return HttpServerResponse.fromWeb(response);
				}),
			);

			yield* router.get(
				'/jobs/events',
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest;
					const webRequest = yield* HttpServerRequest.toWeb(request);
					return HttpServerResponse.fromWeb(
						handleJobsStream(options.jobs, webRequest.signal),
					);
				}),
			);

			yield* router.get(
				'/jobs/:jobId/events',
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest;
					const webRequest = yield* HttpServerRequest.toWeb(request);
					const params = yield* HttpRouter.params;
					const jobId = params.jobId;
					if (jobId === undefined) {
						return HttpServerResponse.empty({ status: 404 });
					}
					return HttpServerResponse.fromWeb(
						handleJobEvents(options.jobs, jobId, webRequest.signal),
					);
				}),
			);

			yield* router.get(
				'/jobs/:jobId/wait',
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest;
					const params = yield* HttpRouter.params;
					const jobId = params.jobId;
					if (jobId === undefined) {
						return HttpServerResponse.empty({ status: 404 });
					}
					const searchParams = yield* HttpServerRequest.ParsedSearchParams;
					const timeoutParam = searchParams.timeoutMs;
					const timeoutMs =
						typeof timeoutParam === 'string'
							? Number.parseInt(timeoutParam, 10)
							: WAIT_TIMEOUT_DEFAULT_MS;
					const response = yield* Effect.promise(() =>
						handleJobWait(options.jobs, jobId, timeoutMs, options.rt),
					);
					return HttpServerResponse.fromWeb(response);
				}),
			);

			if (options.filemap !== undefined) {
				const filemap = options.filemap;
				yield* router.get(
					'*',
					Effect.gen(function* () {
						const request = yield* HttpServerRequest.HttpServerRequest;
						const url = new URL(request.url);
						const spaResponse = serveSPA(filemap, url.pathname);
						if (spaResponse === undefined) {
							return HttpServerResponse.empty({ status: 404 });
						}
						return HttpServerResponse.fromWeb(spaResponse);
					}),
				);
			}
		}),
	);
}

export class Engine extends Effect.Service<Engine>()('engine', {
	effect: Effect.gen(function* () {
		const jobs = yield* Jobs;
		const modelCatalog = yield* ModelCatalog;

		return {
			mcp: {
				registerTools: (
					server: McpServer,
					rt: Runtime.Runtime<never>,
					waitUrlBase: string | undefined,
				) => registerTools(server, jobs, rt, waitUrlBase),
			},
			startServer: (options: ServerOptions) =>
				Effect.gen(function* () {
					const rt = yield* Effect.runtime<never>();
					const portlessPublicBaseRef = yield* Ref.make<string | undefined>(
						undefined,
					);

					const resolvedPort =
						process.env.OPENCODE_MCP_PORT !== undefined
							? Number.parseInt(process.env.OPENCODE_MCP_PORT, 10)
							: options.port;

					const servicesLayer = Layer.merge(
						Layer.succeed(Jobs, jobs),
						Layer.succeed(ModelCatalog, modelCatalog),
					);

					const apiLive = HttpApiBuilder.api(EngineApi).pipe(
						Layer.provide(jobsGroupLayer),
						Layer.provide(aliasesGroupLayer),
						Layer.provide(modelsGroupLayer),
						Layer.provide(servicesLayer),
					);

					const customRoutesLayer = makeCustomRoutesLayer({
						jobs,
						rt,
						serverInfo: options.serverInfo,
						filemap: options.filemap,
						portlessPublicBaseRef,
					});

					const serverLayer = makeServerLayer(resolvedPort);

					const startupLayer = Layer.effectDiscard(
						logStartup(
							resolvedPort,
							options.portless === true,
							portlessPublicBaseRef,
						),
					);

					const httpLive = HttpApiBuilder.serve().pipe(
						Layer.provide(apiLive),
						Layer.provide(customRoutesLayer),
						Layer.provide(startupLayer),
						Layer.provide(serverLayer),
					);

					yield* Layer.launch(httpLive);
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
