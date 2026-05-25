# Development

## Running

The orchestrated way — `bun dev` from repo root starts engine + web in parallel (see also the [web dev doc](../../../apps/web/docs/development.md)).

To run the engine alone:

```sh
bun --filter '@oagent/engine' dev
```

Optional flags: `--port <n>` (default 17777). For the MCP stdio transport:

```sh
cd apps/cli && bun src/index.ts stdio
```

## Sessions

`bun dev` manages dev state under `services/engine/.data/sessions/<slug>/`. Each session contains:

- `sqlite.db` — engine DB
- `dev-port` — sticky port (re-used across restarts of this session)

By default `services/engine/scripts/dev.ts` picks the most recently used session, or creates a new one with a random-noun slug on first run.

To force a fresh session: delete the latest slug dir, or delete all of `services/engine/.data/sessions/`.

## Live URL discovery

While `bun dev` is running, `services/engine/.data/dev.json` contains the live engine URL:

```json
{ "port": 17777, "url": "http://127.0.0.1:17777/mcp" }
```

Written by `services/engine/scripts/dev.ts` on startup; cleaned up on shutdown.

Read it from scripts:

```sh
URL=$(jq -r .url services/engine/.data/dev.json)
```

For probing tools on the running engine, see the `test-oagent-mcp` skill at `.claude/skills/test-oagent-mcp/SKILL.md`.

## Environment variables

| Variable         | Default                      | Description                                                                    |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `OAGENT_DB_PATH` | `~/.config/oagent/sqlite.db` | SQLite path. `services/engine/scripts/dev.ts` sets it to the session's `sqlite.db`.  |
| `ENGINE_URL`     | (unset)                      | Used by `apps/web` Vite proxy. `services/engine/scripts/dev.ts` sets it via dev.json. |
