#!/usr/bin/env bun
import { BunRuntime } from '@effect/platform-bun';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Cause, Effect, Exit, Runtime } from 'effect';
import * as v from 'valibot';
import { Jobs } from '#/jobs';

const OPENCODE_START_DESCRIPTION = `\
Delegate a task to OpenCode, a separate coding agent running as a subprocess. \
Semantically equivalent to Claude Code's built-in Agent tool, but the underlying \
agent is OpenCode. Returns immediately with a jobId. You MUST follow up by calling \
opencode_wait with that jobId and polling until status is "done" or "error". The \
first opencode_wait response with status "done" will include the OpenCode sessionId; \
pass that sessionId back into a subsequent opencode_start call to continue the same \
conversation. The model parameter takes an OpenCode model id in provider-prefixed \
format (run \`opencode models\` in a terminal to discover available ids — e.g. \
opencode-go/kimi-k2.6, openrouter/anthropic/claude-sonnet-4.5); if omitted, \
OpenCode's configured default is used. The cwd parameter is required: an absolute \
path to the directory OpenCode should operate in — typically the parent agent's \
project root.`;

const OPENCODE_WAIT_DESCRIPTION = `\
Wait for an OpenCode job (started via opencode_start) to complete. Blocks up to \
timeoutMs (default 50000, capped at 55000 to stay under Claude Code's tool \
timeout). Returns a discriminated union: { status: "running" } — call again to \
keep waiting; { status: "done", text, sessionId, stopReason } — the final \
aggregated assistant text plus the sessionId you can pass back to opencode_start \
to continue the same conversation; { status: "error", message } — the job \
terminated with an error. Always poll until status is "done" or "error" before \
treating the task as complete.`;

const StartArgsSchema = v.object({
  prompt: v.string(),
  cwd: v.string(),
  model: v.optional(v.string()),
  sessionId: v.optional(v.string()),
});

const WaitArgsSchema = v.object({
  jobId: v.string(),
  timeoutMs: v.optional(v.number()),
});

const program = Effect.gen(function* () {
  const jobs = yield* Jobs;
  const rt = yield* Effect.runtime<never>();

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

  const server = new Server(
    { name: 'opencode-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

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
                'Resume a prior OpenCode session. Pass the sessionId returned from a previous opencode_wait done response.',
            },
          },
          required: ['prompt', 'cwd'],
        },
      },
      {
        name: 'opencode_wait',
        description: OPENCODE_WAIT_DESCRIPTION,
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
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    }

    if (request.params.name === 'opencode_wait') {
      const parsed = v.safeParse(WaitArgsSchema, request.params.arguments);
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
      const result = await runHandler(
        jobs.wait(parsed.output).pipe(
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

  yield* Effect.tryPromise({
    try: () => server.connect(new StdioServerTransport()),
    catch: (cause) =>
      new Error(
        `Failed to connect MCP transport: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
  });

  yield* Effect.never;
}).pipe(Effect.provide(Jobs.Default));

BunRuntime.runMain(program);
