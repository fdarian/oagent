import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
	type AgentTypePreset,
	type AliasPreset,
	cancelTool,
	formatAgentTypes,
	formatCancellation,
	formatPresets,
	formatSessionError,
	formatToolError,
	formatTurnResult,
	readTool,
	sendMessageTool,
	startInputSchema,
	startWorktreeInputSchema,
} from '@oagent/engine';
import { Effect } from 'effect';
import { createEngineClient, type EngineClient } from '#/lib/engine-client.ts';
import type { Version } from '#/lib/misc.ts';

type WaitResult = Awaited<ReturnType<EngineClient['jobs']['wait']>>;

/** Short timeout for the single post-terminal jobs.wait fetch (job is already terminal). */
const TERMINAL_FETCH_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_DEFAULT_MS = 50_000;
/**
 * Max wait for a read tool call. Cap is a deliberate poll-style
 * responsiveness choice — returns {status:"running"} so the caller can re-poll or do
 * other work. NOT a harness limit: Claude Code's MCP tool-call timeout defaults to
 * ~27.7h (see getStartTimeoutMs in services/engine/src/jobs.ts).
 */
const READ_TIMEOUT_MAX_MS = 55_000;

function channelInstructions(source: string) {
	return `Background coding-agent turns finish with a <channel source="${source}" job_id="..." status="..." session_id="..."> notification. Its body is the final assistant message (or an error / cancellation note). Continue your task; no reply is expected. Pass session_id to send_message to continue that session.`;
}

function channelStartDescription(source: string) {
	return `Start a coding-agent session or fork an existing session/job. Pass its session ID to send_message to continue. Foreground calls wait for the result; set background to return immediately and receive a <channel source="${source}" job_id="..." status="..." session_id="..."> notification when the turn finishes. If it returns a running status, call read with the session ID or run oagent jobs wait <jobId> in the background. cwd is an absolute working directory, optional when forkId is set.`;
}

function channelReadDescription() {
	return 'Read the latest turn in a session, waiting briefly if it is still running. If it remains running, call again later or run oagent jobs wait <jobId> as a background command.';
}
function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function textContent(text: string) {
	return { content: [{ type: 'text' as const, text }] };
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

function channelEventFor(jobId: string, sessionId: string, result: WaitResult) {
	if (result.status === 'done') {
		const meta: Record<string, string> = {
			job_id: jobId,
			status: 'done',
			session_id: sessionId,
		};
		if (result.stopReason !== undefined) {
			meta.stop_reason = result.stopReason;
		}
		return { content: result.text, meta };
	}
	if (result.status === 'error') {
		return {
			content: `Agent job failed: ${result.message}`,
			meta: { job_id: jobId, session_id: sessionId, status: 'error' },
		};
	}
	return {
		content: 'Agent job was cancelled.',
		meta: { job_id: jobId, session_id: sessionId, status: 'cancelled' },
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
	sessionId: string,
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
				const event = channelEventFor(jobId, sessionId, result);
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
			{ job_id: jobId, session_id: sessionId, status: 'error' },
		).catch(() => {});
	}
}

async function fetchStartDescriptionData(client: EngineClient): Promise<{
	aliases: AliasPreset[];
	agentTypes: AgentTypePreset[];
	worktreeEnabled: boolean;
}> {
	const responses = await Promise.all([
		client.aliases.list(),
		client.agents.list(),
		client.settings.getWorktree(),
	]);
	return {
		aliases: responses[0].map(
			(row): AliasPreset => ({
				name: row.name,
				backend: row.backend,
				model_id: row.model_id,
				reasoning_effort: row.reasoning_effort,
				...(row.description === undefined
					? {}
					: { description: row.description }),
			}),
		),
		agentTypes: responses[1].map(
			(agent): AgentTypePreset => ({
				name: agent.name,
				...(agent.description === undefined
					? {}
					: { description: agent.description }),
			}),
		),
		worktreeEnabled:
			responses[2].enabled && responses[2].createCommand.trim() !== '',
	};
}

/** Returns the registered start tool handle so the caller can update its description. */
function registerChannelTools(
	server: McpServer,
	client: EngineClient,
	engineUrl: string,
	mcpName: string,
) {
	const startTool = server.registerTool(
		'start',
		{
			description: channelStartDescription(mcpName),
			inputSchema: startInputSchema,
		},
		async (args) => {
			try {
				const startTimeout = await client.settings.getStartTimeout();
				const started = await client.sessions.start({
					prompt: args.prompt,
					cwd: args.cwd,
					model: args.model,
					agent_type: args.agent_type,
					forkId: args.forkId,
					worktree: 'worktree' in args && args.worktree === true,
				});
				if (args.background === true) {
					void waitAndNotify(
						server,
						client,
						engineUrl,
						started.sessionId,
						started.jobId,
					);
					return textContent(
						formatTurnResult({
							sessionId: started.sessionId,
							jobId: started.jobId,
							result: { status: 'running' },
							worktreePath: started.worktreePath,
							worktreeBranch: started.worktreeBranch,
						}),
					);
				}
				const result = await client.sessions.read({
					sessionId: started.sessionId,
					timeoutMs: startTimeout.minutes * 60_000,
				});
				if (result.status === 'running') {
					void waitAndNotify(
						server,
						client,
						engineUrl,
						started.sessionId,
						started.jobId,
					);
				}
				return textContent(
					formatTurnResult({
						sessionId: started.sessionId,
						jobId: started.jobId,
						result,
						worktreePath: started.worktreePath,
						worktreeBranch: started.worktreeBranch,
					}),
				);
			} catch (cause) {
				return textContent(formatToolError(errorMessage(cause)));
			}
		},
	);

	server.registerTool(
		'send_message',
		{
			description: sendMessageTool.description,
			inputSchema: sendMessageTool.inputSchema,
		},
		async (args) => {
			try {
				const startTimeout = await client.settings.getStartTimeout();
				const started = await client.sessions.sendMessage({
					sessionId: args.sessionId,
					prompt: args.prompt,
				});
				if (started.delivery === 'steered') {
					return textContent(
						formatTurnResult({
							sessionId: started.sessionId,
							jobId: started.jobId,
							result: { status: 'running' },
							steered: true,
						}),
					);
				}
				if (args.background === true) {
					void waitAndNotify(
						server,
						client,
						engineUrl,
						started.sessionId,
						started.jobId,
					);
					return textContent(
						formatTurnResult({
							sessionId: started.sessionId,
							jobId: started.jobId,
							result: { status: 'running' },
						}),
					);
				}
				const result = await client.sessions.read({
					sessionId: started.sessionId,
					timeoutMs: startTimeout.minutes * 60_000,
				});
				if (result.status === 'running') {
					void waitAndNotify(
						server,
						client,
						engineUrl,
						started.sessionId,
						started.jobId,
					);
				}
				return textContent(
					formatTurnResult({
						sessionId: started.sessionId,
						jobId: started.jobId,
						result,
					}),
				);
			} catch (cause) {
				return textContent(
					formatSessionError(args.sessionId, errorMessage(cause)),
				);
			}
		},
	);

	server.registerTool(
		'read',
		{
			description: channelReadDescription(),
			inputSchema: readTool.inputSchema,
		},
		async (args) => {
			try {
				const result = await client.sessions.read({
					sessionId: args.sessionId,
					timeoutMs: Math.min(
						args.timeoutMs ?? READ_TIMEOUT_DEFAULT_MS,
						READ_TIMEOUT_MAX_MS,
					),
				});
				return textContent(
					formatTurnResult({
						sessionId: args.sessionId,
						jobId: result.jobId,
						result,
					}),
				);
			} catch (cause) {
				return textContent(
					formatSessionError(args.sessionId, errorMessage(cause)),
				);
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
				const result = await client.sessions.cancel({
					sessionId: args.sessionId,
				});
				return textContent(
					result.ok
						? formatCancellation({
								sessionId: args.sessionId,
								status: result.status,
							})
						: formatSessionError(
								args.sessionId,
								`Session not found: ${args.sessionId}`,
							),
				);
			} catch (cause) {
				return textContent(
					formatSessionError(args.sessionId, errorMessage(cause)),
				);
			}
		},
	);

	return startTool;
}

/**
 * Runs the dedicated Claude Code channel MCP over stdio. Unlike the in-process stdio
 * command, this bridges to a running oagent engine over HTTP and pushes job completions
 * into the session as channel events instead of requiring the caller to poll.
 */
export function runChannelServer(params: {
	version: Version;
	engineUrl: string;
	mcpName: string;
}) {
	return Effect.gen(function* () {
		const client = createEngineClient(params.engineUrl);

		const server = new McpServer(
			{ name: params.mcpName, version: params.version },
			{
				capabilities: {
					tools: {},
					experimental: { 'claude/channel': {} },
				},
				instructions: channelInstructions(params.mcpName),
			},
		);

		const startTool = registerChannelTools(
			server,
			client,
			params.engineUrl,
			params.mcpName,
		);

		// Fetch after connecting so a channel started before the engine still picks up current options.
		server.server.oninitialized = () => {
			void Effect.runFork(
				Effect.tryPromise({
					try: () => fetchStartDescriptionData(client),
					catch: (cause) =>
						new Error(
							`Failed to load start tool options: ${errorMessage(cause)}`,
						),
				}).pipe(
					Effect.tap((data) =>
						Effect.sync(() => {
							startTool.update({
								description: `${channelStartDescription(params.mcpName)}${formatPresets(data.aliases)}${formatAgentTypes(data.agentTypes)}`,
								paramsSchema: data.worktreeEnabled
									? startWorktreeInputSchema
									: startInputSchema,
							});
						}),
					),
					Effect.catch((error) => Effect.logWarning(error.message)),
				),
			);
		};

		yield* Effect.tryPromise({
			try: () => server.connect(new StdioServerTransport()),
			catch: (cause) =>
				new Error(`Failed to connect MCP transport: ${errorMessage(cause)}`),
		});

		yield* Effect.never;
	});
}
