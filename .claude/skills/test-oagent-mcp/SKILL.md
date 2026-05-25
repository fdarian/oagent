---
name: test-oagent-mcp
description: Test and probe the oagent MCP server's tools using the official `@modelcontextprotocol/inspector` CLI. Use this skill whenever an agent needs to list tools, call a tool, or otherwise inspect/debug the oagent MCP server during development — including phrases like "test the MCP", "probe the MCP", "inspect MCP tools", "call a tool", "list MCP tools", or "debug MCP". Prefer this over manually crafting JSON-RPC POST requests.
---

## When to use

- You need to verify what tools the oagent MCP server exposes, or confirm a tool is wired up correctly.
- You want to call a tool (e.g. `start`, `result`) against a running oagent instance and inspect its response.
- Ad-hoc debugging during development — not for wiring oagent into a Claude Code session.

## Discover the live URL

The engine must already be running via `bun dev` (see [engine dev doc](../../../services/engine/docs/development.md)). Do not spawn your own server — ask the user to start `bun dev` if it isn't running.

```sh
URL=$(jq -r .url services/engine/.data/running.json)
```

Use `127.0.0.1`, not `localhost`, to avoid IPv6 resolution issues. The MCP endpoint is `$URL/mcp`.

## List tools

```sh
npx -y @modelcontextprotocol/inspector --cli "$URL/mcp" --method tools/list
```

## Call a tool

Use `--method tools/call`, `--tool-name`, and `--tool-arg key=value` (repeatable):

```sh
npx -y @modelcontextprotocol/inspector --cli "$URL/mcp" \
  --method tools/call \
  --tool-name start \
  --tool-arg prompt="hello from inspector" \
  --tool-arg cwd="/tmp"
```

Returns `{jobId, waitUrl}`. Poll `waitUrl` or use the `result` tool to get final output.

## UI mode

```sh
npx -y @modelcontextprotocol/inspector
```

Opens at http://localhost:6274. Connect to `$URL/mcp` (from `running.json`) via the connection pane. Useful for click-through exploration; for scripting use `--cli`.
