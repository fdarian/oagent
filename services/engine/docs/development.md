# Development

## Running

`pnpm dev` from repo root starts engine + web in parallel (see also the [web dev doc](../../../apps/web/docs/development.md)). To run the engine alone:

```sh
pnpm --filter '@oagent/engine' dev
```

## Sessions

`pnpm dev` manages dev state under `services/engine/.data/sessions/<slug>/`. Each session is used as `OAGENT_HOME_DIR` and contains:

- `sqlite.db` — engine DB
- `sess.json` — per-session persistent state (sticky port, etc.)

By default `services/engine/scripts/dev.ts` picks the most recently used session, or creates a new one with a random-noun slug on first run. The session home keeps development config and data separate from the installed app; without a session `config.json`, portless stays disabled.

To force a fresh session: delete the latest slug dir, or delete all of `services/engine/.data/sessions/`.

## Live URL discovery

While `pnpm dev` is running, `services/engine/.data/running.json` contains the live engine URL:

```json
{ "url": "http://127.0.0.1:17777" }
```

Written by `services/engine/scripts/dev.ts` on startup; cleaned up on shutdown.

For probing tools on the running engine, see the `test-oagent-mcp` skill at `.claude/skills/test-oagent-mcp/SKILL.md`.

## Environment variables

| Variable          | Default            | Description                                                                                  |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `OAGENT_HOME_DIR` | `~/.config/oagent` | Base directory for oagent-owned files. `config.json`, `sqlite.db`, and `logs/` are derived from it. |
