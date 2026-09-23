# Claude Code channel MCP

`oagent claude mcp serve` runs a dedicated stdio MCP that uses Claude Code's
experimental [channel](https://code.claude.com/docs/en/channels) capability.
Instead of making the caller poll a job, the channel MCP **pushes** a completed
turn into the Claude Code session as a one-way notification.

The regular HTTP daemon and stdio MCP keep working unchanged — this is an
additional, opt-in way to run oagent.

## How it differs from the other MCPs

| | HTTP daemon / stdio | Channel MCP |
| --- | --- | --- |
| Runs jobs in-process | yes (stdio) / in the daemon | no — bridges to a running engine over HTTP |
| Getting the result | call `read` with the session ID | pushed into the session when the turn finishes |
| Claude Code launch flag | none | `--dangerously-load-development-channels` (research preview) |

The channel MCP is a thin client to the engine. `start` and `send_message` return
markdown text containing session and job IDs. Background turns return
immediately; a background waiter listens on the engine's SSE stream and, when the
turn is terminal, pushes its result into the session as a
`<channel source="oagent" job_id="…" status="…" session_id="…">` event. The
`read` and `cancel` tools are available as fallbacks.

## Prerequisites

- A running oagent engine (the HTTP daemon). Start it first:

  ```sh
  oagent serve
  # oagent listening on http://127.0.0.1:17777/mcp
  ```

- Claude Code with channel support (research preview — currently behind a
  development flag).

## Register the channel MCP

Register it as a **stdio** server. The config key you choose here is what you
reference in the launch flag below — this example uses `oagent-channel`:

```sh
claude mcp add oagent-channel -- oagent claude mcp serve
```

If your engine runs on a non-default port or host, pass `--engine-url`:

```sh
claude mcp add oagent-channel -- oagent claude mcp serve --engine-url http://localhost:17777
```

The engine URL defaults to `http://localhost:17777` (or `$OPENCODE_MCP_PORT` if
set), matching `oagent serve`.

## Launch Claude Code with the channel loaded

Channels are a research preview, so Claude Code only loads them when started with
an explicit flag. `server:<configKey>` selects the MCP server you registered
above:

```sh
claude --dangerously-load-development-channels server:oagent-channel
```

Without this flag the MCP still works — its tools are available — but completion
notifications are silently dropped (the channel isn't loaded to receive them),
so call `read` with the session ID to fetch the latest turn.

## Using it

1. Call `start` with a `prompt` and `cwd`. It returns markdown containing a
   `Session ID`, `Job ID`, and `Status`. Set `background: true` to return while
   the turn runs.
2. Continue with other work — **don't** poll. When a background turn finishes,
   its final assistant response is pushed into the session as a channel event:

   ```
   <channel source="oagent" job_id="019e…" status="done" session_id="ses_…">
   …the agent's final output…
   </channel>
   ```

   `status` is `done`, `error`, or `cancelled`. Pass the `session_id` back as
   `sessionId` to `send_message` to continue the same conversation.
3. If you suspect a notification was missed, call `read` with the `sessionId`
   to fetch the latest turn.

`send_message` steers an active OpenCode turn or starts a new turn when the
session is idle. `cancel` stops a running turn in the session.
