---
name: test-oagent-mcp
description: Test and probe the oagent MCP server's tools using the official `@modelcontextprotocol/inspector` CLI. Use this skill whenever an agent needs to list tools, call a tool, or otherwise inspect/debug the oagent MCP server during development — including phrases like "test the MCP", "probe the MCP", "inspect MCP tools", "call a tool", "list MCP tools", or "debug MCP". Prefer this over manually crafting JSON-RPC POST requests.
---

## When to use

- You need to verify what tools the oagent MCP server exposes, or confirm a tool is wired up correctly.
- You want to call a tool (e.g. `start`, `read`, `send_message`) against a running oagent instance and inspect its response.
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
  --tool-arg cwd="/tmp" \
  --tool-arg model="opencode:<modelId>"
```

Replace `<modelId>` with a model available to the running OpenCode backend.

The tool response is one markdown text block. `start` and `send_message` include
the public session ID and the turn's job ID; use the session ID with `read` to
fetch the latest turn. `oagent jobs wait <jobId>` is available for a background
shell wait.

## Probe the session tools

The order below exercises new turns,
steering, full-session fork, earlier-job OpenCode fork, cancellation, and listing:

1. Call `start` with `prompt`, `cwd`, `model`, and `background=true`. Save the
   `Session ID` and `Job ID` from its markdown response.
2. Call `read` with that `sessionId` to inspect the current status, or pass `wait=true` to block until terminal.
3. Call `send_message` on the idle session with `background=true`.
4. While that turn is running, call `send_message` again on the same session;
   the response should say the message was queued. Then use `read` with `wait=true`
   to wait for the latest turn to finish.
5. Call `start` with `forkId` set to the session ID.
6. Call `start` with `forkId` set to the first job ID, after a later turn exists
   in the source session. This earlier-job fork requires OpenCode and a recorded
   checkpoint.
7. Start a background turn and call `cancel` with its session ID.
8. Call `list` with `cwd` set to the working directory and confirm the created sessions appear. Omit `cwd` to see recent sessions across directories.

Tool results are markdown in `content[0].text`; the server does not return
`structuredContent`.

## UI mode

```sh
npx -y @modelcontextprotocol/inspector
```

Opens at http://localhost:6274. Connect to `$URL/mcp` (from `running.json`) via the connection pane. Useful for click-through exploration; for scripting use `--cli`.
