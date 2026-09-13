# oagent

MCP server that exposes ACP-compatible coding agents — [OpenCode](https://opencode.ai), [Cursor](https://cursor.com), [Grok](https://x.ai/cli), Codex. Semantically equivalent to Claude Code's built-in `Agent` tool but running the work in a separate agent over the [Agent Client Protocol](https://agentclientprotocol.com).

https://github.com/user-attachments/assets/59e762b9-cfe7-49c6-80ff-03722baf4a68

## Prerequisites

Install the CLI for whichever backend(s) you plan to use — each backend manages its own auth (e.g. `opencode auth login`), oagent doesn't touch it:

| Backend | CLI on `$PATH` | Override env var |
| --- | --- | --- |
| `opencode` | `opencode` | `OAGENT_OPENCODE_BIN` |
| `cursor` | `cursor-agent` | `OAGENT_CURSOR_BIN` |
| `grok` | `grok` | `OAGENT_GROK_BIN` |
| `codex` | `codex-acp` (uses `codex` from `$PATH` when available) | `OAGENT_CODEX_BIN` |

The Codex backend always speaks ACP through `codex-acp`. When a `codex` executable
is available on `$PATH`, oagent passes its path through `CODEX_PATH` so the adapter
uses that installed Codex runtime instead of its bundled one. Set `CODEX_PATH`
explicitly to choose a different Codex runtime; `OAGENT_CODEX_BIN` still selects
the ACP adapter itself.

<details>
<summary>Permissions: `--dangerously-skip-permissions` by default</summary>

oagent auto-approves all of the backend's permission requests — the same pattern Claude Code uses with `--dangerously-skip-permissions`.

There's currently no configurable permission policy at the moment
</details>

## Install

```sh
brew install fdarian/tap/oagent   # preferred
```

Or run it without installing:

```sh
npx oagent
```

<details>
<summary>Build from source</summary>

```sh
git clone https://github.com/fdarian/oagent
cd oagent
pnpm install
pnpm run build   # produces apps/cli/dist/oagent
```

Use `./apps/cli/dist/oagent` in place of `oagent` in the commands below.
</details>

## Getting Started

1. **Start the engine.** Run it in the foreground:

   ```sh
   oagent serve
   # oagent listening on http://127.0.0.1:17777/mcp
   ```

   It stops when you close the terminal (or Ctrl-C). To keep it running across sessions and auto-launch on login instead, install it as a [background service](#background-service).

   The port defaults to `17777` and can be overridden with `OPENCODE_MCP_PORT` (or `--port <n>`). To access oagent at a stable named URL (`https://oagent.localhost`) instead of a bare port, see [docs/using-portless.md](docs/using-portless.md).

2. **Connect Claude Code:**

   ```sh
   claude mcp add --transport http oagent http://localhost:17777/mcp
   ```

3. **Ask your agent to "use oagent."** It'll pick up the tools from there — try asking it to delegate a task with a `prompt` and a `cwd`.

<details>
<summary>stdio fallback (per-session process)</summary>

If you'd rather have Claude Code spawn one MCP server process per session instead of talking to a shared daemon:

```sh
claude mcp add oagent -- /absolute/path/to/oagent stdio
```

No Web UI and no `list` tool in this mode (see [MCP](#mcp)).
</details>

<details>
<summary>Push notifications with [Channel MCP](https://code.claude.com/docs/en/channels) (only for Claude Code)</summary>

A dedicated stdio MCP that pushes job completions into the Claude Code session instead of making the caller poll, using Claude Code's experimental [channel](https://code.claude.com/docs/en/channels) capability. It bridges to a running `oagent serve`/`oagent service` engine over HTTP and is launched with `claude --dangerously-load-development-channels server:oagent-channel`. See [docs/claude-channel-mcp.md](docs/claude-channel-mcp.md).
</details>

## Features

### Background Service

Start the oagent HTTP server in the background through the service command:

```sh
oagent service start
```

To install a macOS launchd login item that starts the server automatically, run:

```sh
oagent service install
```

Then connect Claude Code the same way as in [Getting Started](#getting-started). The port defaults to `17777` and can be overridden with `--port <n>`. Manage the login item and its running server with `oagent service stop|restart|status|uninstall`.

The background service writes JSONL logs to `~/Library/Logs/com.fdarian.oagent/oagent.jsonl` and prunes entries older than 30 days. Set `OAGENT_LOG_DIR` to choose another log directory. Foreground `serve` can write to any path with `--log-file <path>`.

### Web UI

In `serve`/`service` (HTTP) mode, open `http://localhost:17777/` in a browser to see the live job list. Click a job to see its event timeline — text deltas, tool calls, status updates, and errors — streamed live via SSE while the job is running. The UI is a React 19 + Vite + Tailwind v4 SPA, embedded into the standalone binary at build time.

This is only available in HTTP mode. The stdio fallback has no web UI.

## References

### Commands

**server**
- `oagent serve` — run the HTTP server in the foreground. Flags: `--port` (default 17777), `--portless`, `--log-file <path>`.
- **jobs**
  - `oagent jobs list` — list recent jobs. Flags: `--engine-url`, `--limit` (default 10), `--format` (`toon`|`json`).
  - `oagent jobs wait <jobId>` — block until a job reaches a terminal state. Flags: `--engine-url`, `--timeout-ms` (default 3h).
- **claude**
  - `oagent claude mcp serve` — run the Claude Code channel MCP that bridges to a running engine. Flags: `--engine-url`, `--mcp-name`.

**standalone**
- `oagent stdio` — run as a per-session stdio MCP server.

**services** (macOS launchd, auto-starts on login)
- `oagent service start` — start `oagent serve` in the background with JSONL logging. Flags: `--port` (default 17777), `--portless`.
- `oagent service install` — install the macOS login item that runs `oagent service start`. Flag: `--port` (default 17777).
- `oagent service stop` — stop the running server while retaining the login item.
- `oagent service restart` — reinstall and restart the login item. Flag: `--port` (default 17777).
- `oagent service status` — show installation, login, binary, and running status.
- `oagent service uninstall` — stop the server and remove the login item.

**utils**
- `oagent doctor mem` — diagnose memory usage of the backend subprocess tree (macOS only). Flag: `--json`.

### MCP

#### `start`

Launches or continues an agent. By default it blocks (up to 30 minutes) and returns the final result directly.

Input:
- `prompt: string` — the task to send
- `cwd: string` — **required** absolute path to the directory the agent should operate in; typically the parent agent's project root
- `model?: string` — model id in `<backend>:<modelId>` format or a preset alias. Valid backends: `opencode`, `cursor`, `grok`, `codex`. Examples: `opencode:opencode-go/kimi-k2.6`, `cursor:auto`, `cursor:composer-2.5`, `codex:gpt-5.5`. If the user hasn't specified a model, ask them which model and backend to use.
- `sessionId?: string` — pass the `sessionId` returned from a prior `done` result to continue that conversation.
- `background?: boolean` — default `false` (block until finished, up to 30 minutes). If `true`, return immediately with `{ status: "running", jobId }`.

Output (discriminated union):
- `{ status: "done", text, sessionId, stopReason }` — final aggregated assistant text plus the `sessionId` to continue the conversation
- `{ status: "error", message }`
- `{ status: "cancelled" }`
- `{ status: "running", jobId }` — either `background: true` was passed, or the 30-minute blocking window elapsed; use `result` (or `oagent jobs wait <jobId>` as a background shell command) to pick it back up

#### `result`

Fetches the result of a job, blocking up to `timeoutMs` if it's still running. This is the fallback for jobs `start` didn't finish inline (e.g. `background: true`, or the blocking window elapsed).

Input:
- `jobId: string`
- `timeoutMs?: number` — default 50000, capped at 55000 to stay under Claude Code's tool timeout

Output: same discriminated union as `start`.

#### `cancel`

Cancels a running job. Interrupts the underlying agent session and marks the job `cancelled`. Cancelling an already-terminal job is a no-op.

Input:
- `jobId: string`

Output:
- `{ ok: true }` — job was found (running or already terminal)
- `{ ok: false }` — no job with that `jobId` exists

#### `list`

Lists all agent jobs spawned by the current MCP session — id, status, prompt, and creation time. Only available in `/mcp` HTTP mode, where a session id is tracked (not available under `stdio`).

## Limits

The following are intentionally not supported:
- Worktree isolation — jobs run against the given `cwd` directly; there's no isolated worktree per job (background detach itself is supported via `start`'s `background` param)
- Streaming partial output — you only see the aggregated text on `done`
- No auth — the HTTP daemon binds to `127.0.0.1` only; no token is required or checked

Jobs and events persist to SQLite at `~/.config/oagent/sqlite.db` (override with `OAGENT_DB_PATH`). On restart, any jobs that were in-flight are marked as errored automatically.

## Diagnostics

If a process monitor shows oagent using gigabytes of memory, run `oagent doctor mem` (macOS only) for a breakdown of the backend's subprocess tree. See [docs/doctor-mem.md](docs/doctor-mem.md).

## Development

```sh
pnpm dev         # parallel: engine + vite dev server
pnpm check       # typecheck + biome lint across all packages
pnpm run build   # produce standalone binary at apps/cli/dist/oagent
```

Architecture: `AGENTS.md`.
