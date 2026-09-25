# oagent

MCP server that exposes OpenCode to Claude Code as a subagent via ACP, with a React SPA for live job observability.

## Stack

- **pnpm** for package management (`pnpm install`, `pnpm add <pkg>` from inside the target package) — never hand-edit `package.json` dependency fields. Shared versions live in the `catalog:` entry of `pnpm-workspace.yaml`. **Bun** is the runtime (`bun run ...`, `bun build --compile`).
- TypeScript, Effect.ts
- @modelcontextprotocol/server — MCP server implementation (2026-07-28 with stateless legacy support)
- @agentclientprotocol/sdk — direct ACP session over opencode subprocess
- @orpc/server + @orpc/experimental-effect — typed RPC with native Effect handlers
- React 19 + Vite + Tailwind v4 — web SPA, embedded into the binary at build time

## Workspace

Declared in `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `services/*`).

- `apps/cli` (`@oagent/cli`) — thin binary entry point.
- `apps/web` (`@oagent/web`) — Vite + React SPA; type-imports `EngineRouter` from `@oagent/engine`.
- `services/engine` (`@oagent/engine`) — Effect services (`Sessions`, `Jobs`, `OpenCode`), HTTP handlers, oRPC router.

## Dev

Quick commands:

```sh
pnpm dev       # parallel: engine + vite; engine picks port and DB session, web polls for engine URL
pnpm check     # typecheck + biome across all packages
pnpm run build # produce standalone binary at apps/cli/dist/oagent
```

For details see:
- [Engine dev](services/engine/docs/development.md) — sessions, sticky port, env vars
- [Web dev](apps/web/docs/development.md) — Vite proxy, `ENGINE_URL`

## Architecture

- `apps/cli/src/index.ts` — Effect CLI with `serve`, `service`, `stdio`, `jobs`, `doctor`, and `claude mcp serve` subcommands. `serve` loads the embedded SPA filemap from `.gen/web-ui.gen.ts` and delegates to the engine's `createServer`; `--log-file` writes JSONL records with 30-day retention. `service start` launches the `serve` command in the background with the resolved service log file and Info-level logging, then records its PID; `service install|restart|status|stop|uninstall` manage the macOS-only launchd LaunchAgent and that background process. `stdio` serves MCP through `serveStdio` and `registerTools`. Only the commands that need the in-process engine provide `Engine.layer`; the CLI root provides only `BunContext`, deliberately, so `claude mcp serve` (which does NOT need it) never opens the DB and runs orphan-recovery against a live engine's jobs.
- `apps/cli/src/lib/logging.ts` — shared Effect JSONL logging for `serve`: one file path, batched appends, serialized 30-day entry retention, and tracer events.
- `apps/cli/src/commands/service` — launchd-backed login-item management for macOS. `install` writes `~/Library/LaunchAgents/com.oagent.service.plist` with the compiled binary's `service start` command and loads it with `launchctl bootstrap`; `start` detaches `oagent serve`, passes the resolved `oagent.jsonl` path, and records `$OAGENT_HOME_DIR/service.pid` (default `~/.config/oagent/service.pid`); `stop` terminates that server and unloads the login item while retaining the plist; `uninstall` terminates the server, unloads, and removes the plist. `status` reports installation, RunAtLoad, binary, port, and process state. Installing the login item requires the built `oagent` binary; direct development starts can use Bun.
- `apps/cli/src/commands/claude.ts` + `apps/cli/src/lib/channel.ts` — `oagent claude mcp serve` runs a dedicated [Claude Code channel](https://code.claude.com/docs/en/channels-reference) MCP over stdio. Unlike `stdio`, it does not run jobs in-process: it is a thin oRPC client (`@orpc/client`) bridging to a running engine (`--engine-url`, default `http://localhost:17777` or `$OPENCODE_MCP_PORT`). `start` and `send_message` use session RPC procedures and return markdown with session/job IDs; background turns listen to `/jobs/:id/events` until the `__terminal__` sentinel, fetch the final job result once, and push it as a `notifications/claude/channel` event (`<channel source="oagent" job_id status session_id>…</channel>`). `read` and `cancel` are available as fallbacks. Enable with `claude --dangerously-load-development-channels server:<configKey>` during the research preview.
- `services/engine/src/server.ts` — the actual HTTP dispatcher. `createServer({ port, serverInfo, filemap? })` builds the Bun.serve fetch handler and binds it. Routes, in order: `/mcp` → stateless `createMcpHandler` (modern 2026-07-28 and stateless 2025 clients), `/rpc/*` → engine oRPC handler, `/jobs/:id/events` → raw SSE, `/jobs/:id/wait` → long-poll JSON. SPA fallback only fires when `filemap` is provided; otherwise returns 404. Defaults to port 17777 (overridable via `--port` or `OPENCODE_MCP_PORT`); falls back to port 0 on EADDRINUSE. Startup notifications go through the Effect logger, so foreground `serve` prints prettily and `serve --log-file` captures the same events as JSONL.
- `services/engine/src/cli.ts` — dev-only `@effect/cli` entrypoint for the engine. Exposes a single `serve` subcommand that calls `createServer` without a filemap. Used by `services/engine/scripts/dev.ts`.
- `apps/cli/scripts/build.ts` — runs `vite build` in `apps/web`, walks `apps/web/dist/`, generates `apps/cli/.gen/web-ui.gen.ts` with `import ... with { type: 'file' }` plus a default-export filemap, then `Bun.build({ compile: true })` listing both entrypoints so assets embed into the standalone binary.
- `services/engine/src/paths.ts` — resolves `OAGENT_HOME_DIR` (default `~/.config/oagent`) and derives the config, SQLite, logs, and other oagent-owned paths used by the engine and CLI.
- `services/engine/src/db/schema.ts` — Drizzle SQLite schema. `sessions` and `jobs` have UUIDv7 public ids + internal autoincrement PKs; jobs reference their session and a partial unique index allows one running job per session. `events` is a polymorphic base with per-variant tables (`chunk_events`, `tool_call_events`, `plan_events`, etc.). All 11 `SessionUpdate` variants are modeled. Opaque nested fields stay JSON; structured fields are decomposed. Property names are snake_case so they map verbatim to SQL.
- `services/engine/src/db/client.ts` — `Db` Effect service with `scoped` lifecycle. Opens `$OAGENT_HOME_DIR/sqlite.db` (default `~/.config/oagent/sqlite.db`) with WAL + foreign_keys + busy_timeout pragmas. Runs embedded migrations and orphan recovery (`UPDATE jobs SET status='error' WHERE status='running'`) on acquire.
- `services/engine/src/config.ts` — Effect-based JSON config loader. Reads `$OAGENT_HOME_DIR/config.json` (default `~/.config/oagent/config.json`), validates via Effect Schema, and returns decoded values. Missing file is normal and yields defaults; malformed files surface as errors. Currently exposes the `portless` boolean.
- `services/engine/src/db/migrate.ts` — Embedded migration runner. Reuses Drizzle's internal `dialect.migrate(...)` by constructing `MigrationMeta[]` from `with { type: 'text' }` imported SQL files (codegenned by `scripts/gen-migrations.ts`). Keeps parity with `drizzle-kit migrate` dev workflow.
- `services/engine/src/sessions.ts` — `Sessions` Effect service. Creates sessions before their first job, resolves forks by session/job ID (including earlier-job OpenCode REST checkpoints), starts idle turns, steers busy OpenCode turns, reads the latest turn, cancels, and lists recent sessions with an optional cwd filter.
- `services/engine/src/jobs.ts` — `Jobs` Effect service runs turns for existing session rows. `Jobs.start` reserves a job, forks the selected backend turn into a daemon fiber, and returns a `jobId`; events are written to SQLite in a transaction (base `events` row + variant table). OpenCode message checkpoints are captured when a turn ends. `Jobs.wait` blocks until terminal unless given a timeout for polling. Live SSE fanout uses an in-memory `EventEmitter` keyed by job id; history is read from DB. Jobs persist indefinitely; no sweep. Does not know about MCP or HTTP.
- `services/engine/src/worktree.ts` — `Worktrees` Effect service renders the configured create command, resolves the new branch from Git's worktree listing, and preserves the caller's relative subdirectory; worktrees are retained after jobs finish.
- `services/engine/src/opencode.ts` — `OpenCode` Effect service wrapping the opencode ACP subprocess session.
- `services/engine/src/harnesses.ts` — `Harnesses` Effect service that detects, persists, and probes installed ACP harness binaries and manages Codex device-code authentication subprocesses.
- `services/engine/src/http/{sse,wait,spa}.ts` — HTTP response builders. SSE reads history from DB then attaches to the live `EventEmitter` (buffer-then-drain to close the read-then-attach race). Sends `__terminal__` sentinel when the job finishes. Wait blocks via `Jobs.wait` and returns the terminal result as JSON. SPA serves files from the embedded filemap with index.html fallback for client routing.
- `services/engine/src/rpc/router.ts` — oRPC router using `@orpc/experimental-effect`'s builder extensions and native `.effect(...)` handlers. Each handler resolves its Effect services from the request's supplied context, and `EngineRouter` is inferred directly from the router value without explicit output-schema workarounds.
- `services/engine/src/mcp/progress.ts` — shared job-event progress formatting and blocking wait for MCP tools; subscribes to the live job emitter and replays persisted events across the subscribe/read race.
- `apps/cli/src/commands/jobs.ts` — `oagent jobs wait <jobId>` polls in 10-minute chunks (with exponential backoff on transport failures) until the job reaches a terminal status, then prints the shared markdown turn format by default or JSON with `--json`; `oagent jobs list` prints a compact TOON summary by default or JSON with `--format json`.
- `apps/web/src/lib/orpc.ts` — typed oRPC client over `RPCLink` to `/rpc`. In dev Vite proxies to `ENGINE_URL`; in prod served same-origin from the embedded SPA (or `?engine=` query to override).
