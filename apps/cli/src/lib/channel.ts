import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	type AliasPreset,
	cancelTool,
	type EngineRouter,
	formatPresets,
	resultTool,
	startInputSchema,
} from '@oagent/engine';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import { Effect } from 'effect';
import type { Version } from '#/lib/misc.ts';

type EngineClient = RouterClient<EngineRouter>;
type WaitResult = Awaited<ReturnType<EngineClient['jobs']['wait']>>;

/** Short timeout for the single post-terminal jobs.wait fetch (job is already terminal). */
const TERMINAL_FETCH_TIMEOUT_MS = 5_000;
const RESULT_TIMEOUT_DEFAULT_MS = 50_000;
const RESULT_TIMEOUT_MAX_MS = 55_000;

const CHANNEL_INSTRUCTIONS = `\
Job completions from delegated coding-agent tasks arrive as \
<channel source="oagent" job_id="..." status="..." session_id="...">. The body is \
the agent's final output (or an error / cancellation note). These are one-way \
notifications for jobs you started with the start tool — read the result and \
continue your task; no reply is expected. When status is "done", you may pass the \
session_id attribute back as sessionId to a subsequent start call to continue the \
same conversation.`;

const CHANNEL_START_DESCRIPTION = `\
Delegate a task to the coding agent, running as a subprocess via the oagent engine. \
Semantically equivalent to Claude Code's built-in Agent tool, but the underlying \
agent is the coding agent. Supports two backends: OpenCode and Cursor. Returns \
immediately with {jobId}. You do NOT need to poll or wait: when the job finishes, \
its result is pushed into this session as a <channel source="oagent" job_id="..." \
status="..."> event. Continue with other work — you will be notified. The pushed \
event body is the agent's final output; when status is "done" the session_id \
attribute can be passed back as sessionId to a later start call to continue the same \
conversation. If you ever suspect a notification was missed, the result tool fetches \
the same outcome on demand. The cwd parameter is required: an absolute path to the \
directory the agent should operate in — typically the parent agent's project root.`;

const CHANNEL_RESULT_DESCRIPTION = `\
Fetch the result of an agent job started via start. You normally do NOT need this: \
completion is pushed into the session as a <channel source="oagent"> event. Use it \
only as a fallback when you suspect a notification was missed. Blocks up to timeoutMs \
(default 50000, capped at 55000 to stay under Claude Code's tool timeout). Returns a \
discriminated union: { status: "running" } — call again to keep waiting; \
{ status: "done", text, sessionId, stopReason }; { status: "error", message }; \
{ status: "cancelled" }.`;

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function jsonContent(value: unknown) {
	return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function createEngineClient(engineUrl: string): EngineClient {
	const link = new RPCLink({ url: new URL('/rpc', engineUrl) });
	return createORPCClient(link);
}

/** Pushes a single `<channel source="oagent" ...>` event into the Claude Code session. */
function pushChannelEvent(
	server: McpServer,
	content: string,
	meta: Record<string, string>,
) {
	return server.server.notification({
		method: 'notifications/claude/channel',
		params: { content, meta },
	});
}

function channelEventFor(jobId: string, result: WaitResult) {
	if (result.status === 'done') {
		const meta: Record<string, string> = {
			job_id: jobId,
			status: 'done',
			session_id: result.sessionId,
		};
		if (result.stopReason !== undefined) {
			meta.stop_reason = result.stopReason;
		}
		return { content: result.text, meta };
	}
	if (result.status === 'error') {
		return {
			content: `Agent job failed: ${result.message}`,
			meta: { job_id: jobId, status: 'error' },
		};
	}
	return {
		content: 'Agent job was cancelled.',
		meta: { job_id: jobId, status: 'cancelled' },
	};
}

/**
 * Listens to the engine's SSE event stream for the job until the terminal sentinel
 * arrives, fetches the final result once, and pushes the outcome into the session.
 * Fire-and-forget: callers do not await it so start can return immediately.
 */
async function waitAndNotify(
	server: McpServer,
	client: EngineClient,
	engineUrl: string,
	jobId: string,
) {
	const ac = new AbortController();
	try {
		for (;;) {
			const sseUrl = new URL(`/jobs/${jobId}/events`, engineUrl);
			const res = await fetch(sseUrl, { signal: ac.signal });
			if (!res.body) {
				throw new Error('SSE stream has no body');
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let gotTerminal = false;

			while (!gotTerminal) {
				const chunk = await reader.read();
				if (chunk.done) break;

				buffer += decoder.decode(chunk.value, { stream: true });
				const frames = buffer.split('\n\n');
				const tail = frames.pop();
				buffer = tail === undefined ? '' : tail;

				for (const frame of frames) {
					const lines = frame.split('\n');
					let payload: string | undefined;
					for (const line of lines) {
						if (line.startsWith('data:')) {
							payload = line.slice('data:'.length).trim();
							break;
						}
					}
					if (payload === undefined) continue;
					if (payload === '"__terminal__"') {
						gotTerminal = true;
						break;
					}
				}
			}

			await reader.cancel().catch(() => {});

			if (gotTerminal) {
				const result = await client.jobs.wait({
					jobId,
					timeoutMs: TERMINAL_FETCH_TIMEOUT_MS,
				});
				const event = channelEventFor(jobId, result);
				await pushChannelEvent(server, event.content, event.meta);
				return;
			}
			// Stream ended without terminal sentinel; reconnect and resume listening.
		}
	} catch (cause) {
		ac.abort();
		await pushChannelEvent(
			server,
			`Agent job ${jobId} failed while awaiting its result: ${errorMessage(cause)}`,
			{ job_id: jobId, status: 'error' },
		).catch(() => {});
	}
}

function registerChannelTools(
	server: McpServer,
	client: EngineClient,
	engineUrl: string,
	aliases: AliasPreset[],
) {
	server.registerTool(
		'start',
		{
			description: `${CHANNEL_START_DESCRIPTION}${formatPresets(aliases)}`,
			inputSchema: startInputSchema,
		},
		async (args) => {
			try {
				const started = await client.jobs.start(args);
				void waitAndNotify(server, client, engineUrl, started.jobId);
				return jsonContent({ jobId: started.jobId });
			} catch (cause) {
				return jsonContent({ error: { message: errorMessage(cause) } });
			}
		},
	);

	server.registerTool(
		'result',
		{
			description: CHANNEL_RESULT_DESCRIPTION,
			inputSchema: resultTool.inputSchema,
		},
		async (args) => {
			try {
				const result = await client.jobs.wait({
					jobId: args.jobId,
					timeoutMs: Math.min(
						args.timeoutMs ?? RESULT_TIMEOUT_DEFAULT_MS,
						RESULT_TIMEOUT_MAX_MS,
					),
				});
				return jsonContent(result);
			} catch (cause) {
				return jsonContent({ status: 'error', message: errorMessage(cause) });
			}
		},
	);

	server.registerTool(
		'cancel',
		{
			description: cancelTool.description,
			inputSchema: cancelTool.inputSchema,
		},
		async (args) => {
			try {
				return jsonContent(await client.jobs.cancel({ jobId: args.jobId }));
			} catch {
				return jsonContent({ ok: false });
			}
		},
	);
}

/**
 * Runs the dedicated Claude Code channel MCP over stdio. Unlike the in-process stdio
 * command, this bridges to a running oagent engine over HTTP and pushes job completions
 * into the session as channel events instead of requiring the caller to poll.
 */
export function runChannelServer(params: {
	version: Version;
	engineUrl: string;
}) {
	return Effect.gen(function* () {
		const client = createEngineClient(params.engineUrl);

		// Presets enrich the start description, but the engine may not be up yet — best-effort.
		const aliases = yield* Effect.tryPromise(() => client.aliases.list()).pipe(
			Effect.map((rows) =>
				rows.map(
					(row): AliasPreset => ({
						name: row.name,
						backend: row.backend,
						model_id: row.model_id,
						description: row.description ?? null,
					}),
				),
			),
			Effect.catchAll(() => Effect.succeed<AliasPreset[]>([])),
		);

		const server = new McpServer(
			{ name: 'oagent', version: params.version },
			{
				capabilities: {
					tools: {},
					experimental: { 'claude/channel': {} },
				},
				instructions: CHANNEL_INSTRUCTIONS,
			},
		);
		registerChannelTools(server, client, params.engineUrl, aliases);

		yield* Effect.tryPromise({
			try: () => server.connect(new StdioServerTransport()),
			catch: (cause) =>
				new Error(`Failed to connect MCP transport: ${errorMessage(cause)}`),
		});

		yield* Effect.never;
	});
}
