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

- `src/index.ts` — entry point; wires up the MCP server and runs it via BunRuntime
- `src/opencode.ts` — Effect service wrapping the acpx client / opencode ACP session
- `src/jobs.ts` — MCP tool handlers that translate tool calls into ACP job requests
