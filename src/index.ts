#!/usr/bin/env bun
import { randomUUID } from 'node:crypto';
import { BunRuntime } from '@effect/platform-bun';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Cause, Effect, Exit, Runtime } from 'effect';
import * as v from 'valibot';
import { Jobs } from '#/jobs';
import {
  handleJobDetail,
  handleJobEvents,
  handleJobList,
  handleJobWait,
} from '#/web';

const OPENCODE_START_DESCRIPTION = `\
Delegate a task to OpenCode, a separate coding agent running as a subprocess. \
Semantically equivalent to Claude Code's built-in Agent tool, but the underlying \
agent is OpenCode. Returns immediately with {jobId, waitUrl?}. If waitUrl is \
present, the recommended way to wait is to run \`curl -sS <waitUrl>\` as a \
background Bash command (run_in_background=true), then read the result with \
BashOutput when ready. The curl returns the same JSON shape as opencode_result. \
Optionally pass ?timeoutMs=N to the curl URL (default 600000 = 10min). The shell \
will block until the job is terminal or the timeout fires; on timeout the response \
is {status:"running"} and you can curl again. If waitUrl is absent (stdio mode), \
fall back to repeatedly calling opencode_result. The first successful response \
with status "done" will include the OpenCode sessionId; pass that sessionId back \
into a subsequent opencode_start call to continue the same conversation. The model \
parameter takes an OpenCode model id in provider-prefixed format (run \
\`opencode models\` in a terminal to discover available ids — e.g. \
opencode-go/kimi-k2.6, openrouter/anthropic/claude-sonnet-4.5); if omitted, \
OpenCode's configured default is used. The cwd parameter is required: an absolute \
path to the directory OpenCode should operate in — typically the parent agent's \
project root.`;

const OPENCODE_RESULT_DESCRIPTION = `\
Fetch the result of an OpenCode job (started via opencode_start). In HTTP daemon \
mode, prefer the waitUrl from opencode_start; this tool is the stdio-mode \
fallback. Blocks up to timeoutMs (default 50000, capped at 55000 to stay under \
Claude Code's tool timeout). Returns a discriminated union: { status: "running" } \
— call again to keep waiting; { status: "done", text, sessionId, stopReason } — \
the final aggregated assistant text plus the sessionId you can pass back to \
opencode_start to continue the same conversation; { status: "error", message } — \
the job terminated with an error. Always poll until status is "done" or "error" \
before treating the task as complete.`;

const StartArgsSchema = v.object({
  prompt: v.string(),
  cwd: v.string(),
  model: v.optional(v.string()),
  sessionId: v.optional(v.string()),
});

const ResultArgsSchema = v.object({
  jobId: v.string(),
  timeoutMs: v.optional(v.number()),
});

/** Register tools on a Server instance using the given jobs service and Effect runtime. */
function registerTools(
  server: Server,
  jobs: Jobs,
  rt: Runtime.Runtime<never>,
  waitUrlBase: string | undefined,
): void {
  /** Bridge an Effect into a plain Promise, re-throwing the real failure value. */
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

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: 'opencode_start',
        description: OPENCODE_START_DESCRIPTION,
        inputSchema: {
          type: 'object' as const,
          properties: {
            prompt: {
              type: 'string',
              description: 'The task or question to send to OpenCode.',
            },
            cwd: {
              type: 'string',
              description:
                "Absolute path to the directory OpenCode should operate in — typically the parent agent's project root.",
            },
            model: {
              type: 'string',
              description:
                'OpenCode model id (provider-prefixed, e.g. opencode-go/kimi-k2.6). Omit to use OpenCode default.',
            },
            sessionId: {
              type: 'string',
              description:
                'Resume a prior OpenCode session. Pass the sessionId returned from a previous opencode_result done response.',
            },
          },
          required: ['prompt', 'cwd'],
        },
      },
      {
        name: 'opencode_result',
        description: OPENCODE_RESULT_DESCRIPTION,
        inputSchema: {
          type: 'object' as const,
          properties: {
            jobId: {
              type: 'string',
              description: 'The jobId returned by opencode_start.',
            },
            timeoutMs: {
              type: 'number',
              description:
                'Max milliseconds to block (default 50000, capped at 55000).',
            },
          },
          required: ['jobId'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'opencode_start') {
      const parsed = v.safeParse(StartArgsSchema, request.params.arguments);
      if (!parsed.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid arguments: ${JSON.stringify(parsed.issues)}`,
            },
          ],
          isError: true,
        };
      }
      const result = await runHandler(jobs.start(parsed.output));
      const response =
        waitUrlBase !== undefined
          ? {
              jobId: result.jobId,
              waitUrl: `${waitUrlBase}/jobs/${result.jobId}/wait`,
            }
          : { jobId: result.jobId };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      };
    }

    if (request.params.name === 'opencode_result') {
      const parsed = v.safeParse(ResultArgsSchema, request.params.arguments);
      if (!parsed.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid arguments: ${JSON.stringify(parsed.issues)}`,
            },
          ],
          isError: true,
        };
      }
      const WAIT_TIMEOUT_DEFAULT_MS = 50_000;
      const WAIT_TIMEOUT_MAX_MS = 55_000;
      const result = await runHandler(
        jobs
          .wait({
            jobId: parsed.output.jobId,
            timeoutMs: Math.min(
              parsed.output.timeoutMs ?? WAIT_TIMEOUT_DEFAULT_MS,
              WAIT_TIMEOUT_MAX_MS,
            ),
          })
          .pipe(
            Effect.catchTag('JobNotFound', (err) =>
              Effect.succeed({
                status: 'error' as const,
                message: `Job not found: ${err.jobId}`,
              }),
            ),
          ),
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Unknown tool: ${request.params.name}`,
        },
      ],
      isError: true,
    };
  });
}

const program = Effect.gen(function* () {
  const jobs = yield* Jobs;
  const rt = yield* Effect.runtime<never>();

  const mode = process.argv[2] ?? 'serve';

  if (mode === 'stdio') {
    const server = new Server(
      { name: 'oagent', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    registerTools(server, jobs, rt, undefined);

    yield* Effect.tryPromise({
      try: () => server.connect(new StdioServerTransport()),
      catch: (cause) =>
        new Error(
          `Failed to connect MCP transport: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
    });

    yield* Effect.never;
    return;
  }

  if (mode === 'serve') {
    const port =
      process.env.OPENCODE_MCP_PORT !== undefined
        ? Number.parseInt(process.env.OPENCODE_MCP_PORT, 10)
        : 17777;

    const waitUrlBase = `http://127.0.0.1:${port}`;

    /** Map of MCP session ID → { transport, server } */
    const sessions = new Map<
      string,
      { transport: WebStandardStreamableHTTPServerTransport; server: Server }
    >();

    const bunServer = yield* Effect.try({
      try: () =>
        Bun.serve({
          hostname: '127.0.0.1',
          port,
          idleTimeout: 0,
          fetch: async (request) => {
            const url = new URL(request.url);

            if (url.pathname === '/') return handleJobList(jobs);

            const eventsJobId = url.pathname.match(
              /^\/jobs\/([^/]+)\/events$/,
            )?.[1];
            if (eventsJobId !== undefined)
              return handleJobEvents(jobs, eventsJobId, request.signal);

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

            const detailJobId = url.pathname.match(/^\/jobs\/([^/]+)$/)?.[1];
            if (detailJobId !== undefined)
              return handleJobDetail(jobs, detailJobId);

            if (url.pathname !== '/mcp') {
              return new Response('Not Found', { status: 404 });
            }

            const sessionId = request.headers.get('mcp-session-id');

            if (sessionId !== null) {
              const session = sessions.get(sessionId);
              if (session === undefined) {
                return new Response('Session not found', { status: 404 });
              }
              return session.transport.handleRequest(request);
            }

            // No session ID — assume initialize request; create a new session.
            const transport = new WebStandardStreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (sid) => {
                sessions.set(sid, { transport, server: mcpServer });
              },
              onsessionclosed: (sid) => {
                sessions.delete(sid);
              },
            });

            const mcpServer = new Server(
              { name: 'oagent', version: '0.1.0' },
              { capabilities: { tools: {} } },
            );
            registerTools(mcpServer, jobs, rt, waitUrlBase);

            await mcpServer.connect(transport);
            return transport.handleRequest(request);
          },
        }),
      catch: (cause) =>
        new Error(
          `Failed to start HTTP server on port ${port}: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
    });

    process.stderr.write(
      `oagent listening on http://127.0.0.1:${bunServer.port}/mcp\n`,
    );

    yield* Effect.never;
    return;
  }

  yield* Effect.fail(
    new Error(`Unknown mode: "${mode}". Use "serve" (default) or "stdio".`),
  );
}).pipe(Effect.provide(Jobs.Default));

BunRuntime.runMain(program);
