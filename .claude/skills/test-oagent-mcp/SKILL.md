---
name: test-oagent-mcp
description: Test and probe the oagent MCP server's tools using the official `@modelcontextprotocol/inspector` CLI. Use this skill whenever an agent needs to list tools, call a tool, or otherwise inspect/debug the oagent MCP server during development — including phrases like "test the MCP", "probe the MCP", "inspect MCP tools", "call a tool", "list MCP tools", or "debug MCP". Prefer this over manually crafting JSON-RPC POST requests.
---

## When to use

- You need to verify what tools the oagent MCP server exposes, or confirm a tool is wired up correctly.
- You want to call a tool (e.g. `start`, `result`) against a running oagent instance and inspect its response.
- Ad-hoc debugging during development — not for wiring oagent into a Claude Code session.

## List tools against the dev server

`bun dev` writes the live port to `services/engine/.data/dev.json`. Read it before connecting:

```sh
URL=$(jq -r .url services/engine/.data/dev.json)
npx -y @modelcontextprotocol/inspector --cli $URL --method tools/list
```

Use `127.0.0.1`, not `localhost`, to avoid IPv6 resolution issues.

## Spin up an isolated test instance

Pick a free port and a throwaway DB path so the test instance has no shared state:

```sh
cd /Users/farreldarian/code/fdarian/oagent/services/engine && \
  OAGENT_DB_PATH=/tmp/oagent-test/sqlite.db bun src/cli.ts serve --port 17778 &
sleep 2
```

`OAGENT_DB_PATH` is required — without it the instance reads/writes your real DB (`~/.config/oagent/sqlite.db`). Implementation: `services/engine/src/db/path.ts`.

Then inspect:

```sh
npx -y @modelcontextprotocol/inspector --cli http://127.0.0.1:17778/mcp --method tools/list
```

## Call a tool

Use `--method tools/call`, `--tool-name`, and `--tool-arg key=value` (repeatable):

```sh
npx -y @modelcontextprotocol/inspector --cli http://127.0.0.1:17778/mcp \
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

Opens at http://localhost:6274. Connect to `$URL` (from `dev.json`) or your test port via the connection pane. Useful for click-through exploration; for scripting use `--cli`.

## Cleanup

```sh
pkill -f "bun src/cli.ts serve --port 17778"
rm -rf /tmp/oagent-test
```

Adjust port and DB path to match what was used.
