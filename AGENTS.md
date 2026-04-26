# opencode-mcp

MCP server that exposes OpenCode to Claude Code as a subagent via ACP.

## Stack

- Bun, TypeScript, Effect.ts
- @modelcontextprotocol/sdk — MCP server implementation
- acpx — drives `opencode acp` via the ACP protocol

## Dev

```sh
bun dev          # run src/index.ts directly
bun check        # tsc + biome lint
bun run format   # biome format + lint --write
```

## Architecture

- `src/index.ts` — entry point; wires up the MCP server and runs it via BunRuntime. Supports two modes via the first CLI arg (default `serve`):
  - `serve` — long-lived HTTP daemon on `127.0.0.1:<OPENCODE_MCP_PORT|17777>/mcp` using `WebStandardStreamableHTTPServerTransport`; one Server instance per MCP session, shared `Jobs` and `OpenCode` services across all sessions.
  - `stdio` — single-session stdio transport; for backwards compatibility and debugging.
- `src/opencode.ts` — Effect service wrapping the acpx client / opencode ACP session
- `src/jobs.ts` — in-memory job lifecycle service; `Jobs.start` forks `OpenCode.runTurn` into a daemon fiber and returns a `jobId`; `Jobs.wait` blocks up to a timeout and returns `running | done | error`. Terminal jobs (done/error) are swept from the map after 30 min (sweep interval: 5 min). Does not know about MCP.
