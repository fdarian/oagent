# Development

## Running

Start the development engine from `services/engine`:

```sh
bun dev
```

Agents should start it when needed, or reuse the dev engine already running for this checkout. Wait for the engine's listening log before starting clients; `running.json` is written during startup, before the server binds.

The dev script restarts on engine source changes. A restart marks in-flight jobs as errored, so avoid editing engine source while a test turn is running.

To run the web app against this engine, see [web development](../../../apps/web/docs/development.md#full-app-local-engine).

## Sessions

`bun dev` manages dev state under `services/engine/.data/sessions/<slug>/`. Each session is used as `OAGENT_HOME_DIR` and contains:

- `sqlite.db` — engine DB
- `sess.json` — per-session persistent state (sticky port, etc.)

By default `services/engine/scripts/dev.ts` picks the most recently used session, or creates a new one with a random-noun slug on first run. The session home keeps development config and data separate from the installed app; without a session `config.json`, portless stays disabled.

To force a fresh session: delete the latest slug dir, or delete all of `services/engine/.data/sessions/`.

## Live URL discovery

While `bun dev` is running, `services/engine/.data/running.json` contains the engine URL. From the repo root:

```sh
cat services/engine/.data/running.json
```

Read its `url` field rather than assuming port `17777`: the dev script selects a per-session sticky port. The file is written on startup and removed on shutdown. Stop the foreground engine with Ctrl-C when finished.

Use this URL for clients, including `--engine-url` on CLI commands. It uses `127.0.0.1`, avoiding IPv6 resolution issues.

## Probing MCP tools

Use the [MCP inspector](https://github.com/modelcontextprotocol/inspector) CLI against the dev engine's `/mcp` endpoint rather than hand-crafting JSON-RPC requests. Always use the discovered URL: port `17777` can belong to the user's running app, with a different engine version and real data affected by mutations.

```sh
URL=$(jq -r .url services/engine/.data/running.json)
pnpx -y @modelcontextprotocol/inspector --cli "$URL/mcp" --method tools/list
pnpx -y @modelcontextprotocol/inspector --cli "$URL/mcp" --method tools/call --tool-name <tool> --tool-arg key=value
```
