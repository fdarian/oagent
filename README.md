# opencode-mcp

MCP server that exposes [OpenCode](https://opencode.ai) to Claude Code as a subagent — semantically equivalent to Claude Code's built-in `Agent` tool, but the work runs in OpenCode (a separate coding agent) over the [Agent Client Protocol](https://agentclientprotocol.com).

Useful when you want Claude Code to delegate a task to a different model, or to a workflow OpenCode handles better, without leaving the Claude Code session.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- The `opencode` CLI on `$PATH` (run `opencode --version` to confirm)
- `opencode auth login` completed — this MCP server doesn't manage auth; it just drives whichever provider OpenCode is already authenticated against

## Install

```sh
git clone https://github.com/fdarian/opencode-mcp
cd opencode-mcp
bun install
```

### HTTP daemon (default)

Start the daemon once; it persists across Claude Code sessions:

```sh
bun src/index.ts serve
# opencode-mcp listening on http://127.0.0.1:17777/mcp
```

Register with Claude Code over HTTP:

```sh
claude mcp add --transport http opencode http://localhost:17777/mcp
```

The port defaults to `17777` and can be overridden with the `OPENCODE_MCP_PORT` environment variable.

### stdio fallback

If you prefer per-session stdio mode (one MCP server process per Claude Code session):

```sh
claude mcp add opencode -- bun /absolute/path/to/opencode-mcp/src/index.ts stdio
```

Verify in a Claude Code session: ask Claude to call `opencode_start` with a `prompt` and `cwd` — it should return a `jobId`, and a follow-up `opencode_wait` call should resolve to OpenCode's response.

## Tools

### `opencode_start`

Delegates a task to OpenCode and returns a `jobId` immediately.

Input:
- `prompt: string` — the task to send
- `cwd: string` — **required** absolute path to the directory OpenCode should operate in; typically the parent agent's project root
- `model?: string` — OpenCode model id in provider-prefixed format (e.g. `opencode-go/kimi-k2.6`, `openrouter/anthropic/claude-sonnet-4.5`). Run `opencode models` to discover available ids. Omit to use OpenCode's configured default.
- `sessionId?: string` — pass the `sessionId` returned from a prior `opencode_wait` to continue that conversation.

Output: `{ jobId: string }`

### `opencode_wait`

Blocks up to `timeoutMs` waiting for a job to finish. The split into start/wait exists because Claude Code enforces a ~60 s hard timeout per MCP tool call, while OpenCode turns can take minutes — so callers poll `opencode_wait` until the status is terminal.

Input:
- `jobId: string`
- `timeoutMs?: number` — default 50000, capped at 55000 to stay under Claude Code's tool timeout

Output (discriminated union):
- `{ status: "running" }` — call again
- `{ status: "done", text: string, sessionId: string, stopReason: string }` — final aggregated assistant text plus the sessionId you can pass back to `opencode_start` to continue the conversation
- `{ status: "error", message: string }`

## Web UI

In `serve` (HTTP) mode, open `http://localhost:17777/` in a browser to see the live job list. Click a job to see its event timeline — text deltas, tool calls, status updates, and errors — streamed live via SSE while the job is running. The UI is server-rendered HTML; no framework or build step required.

This is only available in `serve` mode. The stdio fallback has no web UI.

## Limits

This is an MVP. The following are intentionally not supported:
- `run_in_background` / worktree isolation — a job runs to completion or errors; no background detach
- Cancellation — there's no `opencode_cancel` yet
- Streaming partial output — you only see the aggregated text on `done`
- No auth — the HTTP daemon binds to `127.0.0.1` only; no token is required or checked
- Configurable permission policy — OpenCode's permission requests are auto-approved (the same pattern Claude Code uses with `--dangerously-skip-permissions`)
- No job persistence across daemon restarts — the in-memory job map is process-local

## Development

```sh
bun dev          # run src/index.ts directly
bun check        # tsc + biome lint
bun run format   # biome format + lint --write
```

Architecture: `AGENTS.md`.
