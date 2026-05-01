# oagent

MCP server that exposes OpenCode to Claude Code as a subagent via ACP.

## Stack

- Bun, TypeScript, Effect.ts
- @modelcontextprotocol/sdk — MCP server implementation
- acpx — drives `opencode acp` via the ACP protocol

## Dev

```sh
bun dev          # run apps/cli/src/index.ts directly
bun check        # tsc + biome lint
bun run format   # biome format + lint --write
```

## Architecture

- `apps/cli/src/index.ts` — entry point; wires up the MCP server and runs it via BunRuntime. Supports two modes via the first CLI arg (default `serve`):
  - `serve` — long-lived HTTP daemon on `127.0.0.1:<OPENCODE_MCP_PORT|17777>/mcp` using `WebStandardStreamableHTTPServerTransport`; one Server instance per MCP session, shared `Jobs` and `OpenCode` services across all sessions. Also exposes a long-poll `GET /jobs/:id/wait` endpoint so callers can wait for jobs via shell `curl` instead of MCP polling.
  - `stdio` — single-session stdio transport; for backwards compatibility and debugging.
- `apps/cli/src/opencode.ts` — Effect service wrapping the acpx client / opencode ACP session
- `apps/cli/src/jobs.ts` — in-memory job lifecycle service; `Jobs.start` forks `OpenCode.runTurn` into a daemon fiber and returns a `jobId`; `Jobs.wait` blocks up to a timeout and returns `running | done | error`. Each job maintains a 200-event ring buffer and an `EventEmitter` for SSE fanout; events are also appended to a per-job ndjson file under `$TMPDIR/oagent-<pid>/jobs/`. Terminal jobs (done/error) are swept from the map after 30 min (sweep interval: 5 min). Does not know about MCP.
- `apps/cli/src/web.ts` — server-rendered HTML + SSE handlers for the web observability UI. Exports `handleJobList`, `handleJobDetail`, `handleJobEvents`, and `handleJobWait`. The SSE endpoint replays the ring buffer on connect, then streams live events via the per-job `EventEmitter`, and sends a `__terminal__` sentinel when the job finishes. The `handleJobWait` endpoint blocks via `Jobs.wait` and returns the terminal result as JSON, letting shell callers long-poll instead of polling through MCP.
