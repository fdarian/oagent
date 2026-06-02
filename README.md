# oagent

MCP server that exposes [OpenCode](https://opencode.ai) to Claude Code as a subagent — semantically equivalent to Claude Code's built-in `Agent` tool, but the work runs in OpenCode (a separate coding agent) over the [Agent Client Protocol](https://agentclientprotocol.com).

Useful when you want Claude Code to delegate a task to a different model, or to a workflow OpenCode handles better, without leaving the Claude Code session.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- The `opencode` CLI on `$PATH` (run `opencode --version` to confirm)
- `opencode auth login` completed — this MCP server doesn't manage auth; it just drives whichever provider OpenCode is already authenticated against

## Install

```sh
git clone https://github.com/fdarian/oagent
cd oagent
bun install
```

### HTTP daemon (default)

Start the daemon once; it persists across Claude Code sessions:

```sh
bun run build           # produces apps/cli/dist/oagent
./apps/cli/dist/oagent serve
# oagent listening on http://127.0.0.1:17777/mcp
```

Register with Claude Code over HTTP:

```sh
claude mcp add --transport http opencode http://localhost:17777/mcp
```

The port defaults to `17777` and can be overridden with the `OPENCODE_MCP_PORT` environment variable.

To access oagent at a stable named URL (`https://oagent.localhost`) instead of a bare port, see [docs/using-portless.md](docs/using-portless.md).

### stdio fallback

If you prefer per-session stdio mode (one MCP server process per Claude Code session):

```sh
claude mcp add opencode -- /absolute/path/to/oagent/apps/cli/dist/oagent stdio
```

Verify in a Claude Code session: ask Claude to call `start` with a `prompt` and `cwd` — it should return a `jobId`, and a follow-up `result` call should resolve to OpenCode's response.

### Channel MCP (push notifications)

A dedicated stdio MCP that pushes job completions into the Claude Code session instead of making the caller poll, using Claude Code's experimental [channel](https://code.claude.com/docs/en/channels) capability. It bridges to a running `oagent serve` engine over HTTP and is launched with `claude --dangerously-load-development-channels server:oagent-channel`. See [docs/claude-channel-mcp.md](docs/claude-channel-mcp.md).

## Tools

### `start`

Delegates a task to the coding agent and returns immediately.

Input:
- `prompt: string` — the task to send
- `cwd: string` — **required** absolute path to the directory the agent should operate in; typically the parent agent's project root
- `model?: string` — model id in `<backend>:<modelId>` format or a preset alias name. Valid backends: `opencode`, `cursor`. Examples: `opencode:opencode-go/kimi-k2.6`, `cursor:auto`, `cursor:composer-2.5`. If the user has not specified a model, ask them which model and backend to use.
- `sessionId?: string` — pass the `sessionId` returned from a prior `result` done response to continue that conversation.

Output:
- HTTP daemon mode: `{ jobId: string, waitUrl: string }` — `waitUrl` is `<origin>/jobs/<jobId>/wait`, a long-poll endpoint; run `curl -sS <waitUrl>` as a background shell command to wait for completion without occupying a tool call slot.
- stdio mode: `{ jobId: string }` — no `waitUrl`; use the `result` tool to poll.

### `result`

Fetches the result of a job, blocking up to `timeoutMs` if it's still running. In HTTP daemon mode, prefer `curl`-ing the `waitUrl` from `start` instead. This tool is the stdio-mode fallback; poll it until the status is terminal.

Input:
- `jobId: string`
- `timeoutMs?: number` — default 50000, capped at 55000 to stay under Claude Code's tool timeout

Output (discriminated union):
- `{ status: "running" }` — call again
- `{ status: "done", text: string, sessionId: string, stopReason: string }` — final aggregated assistant text plus the sessionId you can pass back to `start` to continue the conversation
- `{ status: "error", message: string }`

### `cancel`

Cancels a running job started via `start`. Interrupts the underlying agent session and marks the job `cancelled`. Cancelling an already-terminal job is a no-op.

Input:
- `jobId: string`

Output:
- `{ ok: true }` — job was found (running or already terminal)
- `{ ok: false }` — no job with that `jobId` exists

## Web UI

In `serve` (HTTP) mode, open `http://localhost:17777/` in a browser to see the live job list. Click a job to see its event timeline — text deltas, tool calls, status updates, and errors — streamed live via SSE while the job is running. The UI is a React 19 + Vite + Tailwind v4 SPA, embedded into the standalone binary at build time.

This is only available in `serve` mode. The stdio fallback has no web UI.

## Limits

This is an MVP. The following are intentionally not supported:
- `run_in_background` / worktree isolation — a job runs to completion or errors; no background detach
- Streaming partial output — you only see the aggregated text on `done`
- No auth — the HTTP daemon binds to `127.0.0.1` only; no token is required or checked
- Configurable permission policy — OpenCode's permission requests are auto-approved (the same pattern Claude Code uses with `--dangerously-skip-permissions`)

Jobs and events persist to SQLite at `~/.config/oagent/sqlite.db` (override with `OAGENT_DB_PATH`). On restart, any jobs that were in-flight are marked as errored automatically.

## Development

```sh
bun dev          # parallel: engine + vite dev server
bun check        # typecheck + biome lint across all packages
bun run build    # produce standalone binary at apps/cli/dist/oagent
```

Architecture: `AGENTS.md`.
