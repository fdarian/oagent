# oagent

MCP server that exposes OpenCode to Claude Code as a subagent via ACP, with a React SPA for live job observability.

## Stack

- **pnpm** for package management (`pnpm install`, `pnpm add <pkg>` from inside the target package) — never hand-edit `package.json` dependency fields. Shared versions live in the `catalog:` entry of `pnpm-workspace.yaml`. **Bun** is the runtime (`bun run ...`, `bun build --compile`).
- TypeScript, Effect.ts
- @modelcontextprotocol/server — MCP server implementation (2026-07-28 with stateless legacy support)
- @agentclientprotocol/sdk — direct ACP session over opencode subprocess
- @orpc/server + @orpc/experimental-effect — typed RPC with native Effect handlers
- React 19 + Vite + Tailwind v4 — web SPA, embedded into the binary at build time

Checks: `pnpm check` (typecheck + biome), `pnpm run build` (standalone binary at `apps/cli/dist/oagent`).

## Workspace

Declared in `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `services/*`).

- `apps/cli` (`@oagent/cli`) — thin binary entry point.
- `apps/web` (`@oagent/web`) — Vite + React SPA; type-imports `EngineRouter` from `@oagent/engine`.
- `services/engine` (`@oagent/engine`) — Effect services (`Sessions`, `Jobs`, `OpenCode`), HTTP handlers, oRPC router.

## Architecture

- `apps/cli/src/commands/mcp.ts` + `apps/cli/src/lib/mcp-stdio.ts` — thin-client stdio MCP with ephemeral aliases and agents, bare mode, and on-demand local engine spawning through `engine-spawn.ts`; foreground calls reuse channel SSE progress.
- `services/engine/src/idle.ts` — idle-exit tracking includes requests, streams and running jobs; any `/mcp` request permanently disables idle exit. Idle listeners bind before engine acquisition.
- `sessions.start` accepts inline `agent` definitions, mutually exclusive with `agent_type`, without saving agent configuration.

- `apps/cli/src/index.ts` — CLI with `serve`, `service`, `mcp stdio`, `jobs`, `doctor`, and `claude mcp serve`. Only engine commands provide `Engine.layer`; thin MCP clients never acquire the database or recovery service. `serve` embeds the SPA and supports JSONL logging with 30-day retention; service commands manage the detached server and macOS launchd login item.
- `apps/cli/src/lib/logging.ts` — shared Effect JSONL logging for `serve`: one file path, batched appends, serialized 30-day entry retention, and tracer events.
- `apps/cli/src/commands/service` — launchd-backed login-item management for macOS. `install` writes `~/Library/LaunchAgents/com.oagent.service.plist` with the compiled binary's `service start` command and loads it with `launchctl bootstrap`; `start` detaches `oagent serve`, passes the resolved `oagent.jsonl` path, and records `$OAGENT_HOME_DIR/service.pid` (default `~/.config/oagent/service.pid`); `stop` terminates that server and unloads the login item while retaining the plist; `uninstall` terminates the server, unloads, and removes the plist. `status` reports installation, RunAtLoad, binary, port, and process state. Installing the login item requires the built `oagent` binary; direct development starts can use Bun.
- Service stop allows 30 seconds after SIGTERM before SIGKILL; the LaunchAgent has a 35-second `ExitTimeOut`. `Jobs` scope shutdown cancels live ACP turns and leaves their rows running with `interrupted_at`; startup recovers dead runners under the same job ID through `job-recovery.ts`, with a three-resumption cap and crash rejection for Cursor.
- `serve` explicitly rejects new requests, invokes the idempotent Jobs shutdown, then drains HTTP for up to one second before forced close. A distinct job shutdown event wakes foreground MCP waiters with a normal restart/retry result; it is not a terminal job status.
- `apps/cli/src/commands/claude.ts` + `apps/cli/src/lib/channel.ts` — `oagent claude mcp serve` is a thin oRPC client to a running engine, pushing background job completions through Claude Code channel notifications. Like `mcp stdio`, it never acquires engine services. It supports `--engine-url`, `--mcp-name`, and fallback `read`/`cancel` tools. Enable with `claude --dangerously-load-development-channels server:<configKey>`; see [channel setup](docs/claude-channel-mcp.md).
- `apps/cli/src/lib/channel-stream.ts` reconnects job SSE listeners after transport failures or nonterminal EOF, backing off from 500ms to 5s for up to two minutes of outage; successful connections reset the delay, and caller cancellation stops retries.
- `services/engine/src/server.ts` — the actual HTTP dispatcher. `createServer({ port, serverInfo, filemap? })` builds the Bun.serve fetch handler and binds it. Routes, in order: `/mcp` → stateless `createMcpHandler` (modern 2026-07-28 and stateless 2025 clients), `/rpc/*` → engine oRPC handler, `/jobs/:id/events` → raw SSE, `/jobs/:id/wait` → long-poll JSON. SPA fallback only fires when `filemap` is provided; otherwise returns 404. Defaults to port 17777 (overridable via `--port` or `OPENCODE_MCP_PORT`); falls back to port 0 on EADDRINUSE. Startup notifications go through the Effect logger, so foreground `serve` prints prettily and `serve --log-file` captures the same events as JSONL.
- `services/engine/scripts/dev.ts` — dev entrypoint using `devsess`: selects an isolated session home and sticky port, publishes the engine URL, writes MCP client configs in `spaces/tester`, and starts `Engine` directly.
- `apps/cli/scripts/build.ts` — runs `vite build` in `apps/web`, walks `apps/web/dist/`, generates `apps/cli/.gen/web-ui.gen.ts` with `import ... with { type: 'file' }` plus a default-export filemap, then `Bun.build({ compile: true })` listing both entrypoints so assets embed into the standalone binary.
- `services/engine/src/paths.ts` — resolves `OAGENT_HOME_DIR` (default `~/.config/oagent`) and derives the config, SQLite, logs, and other oagent-owned paths used by the engine and CLI.
- `services/engine/src/db/schema.ts` — Drizzle SQLite schema. `sessions` and `jobs` have UUIDv7 public ids + internal autoincrement PKs; jobs reference their session and a partial unique index allows one running job per session. `events` is a polymorphic base with per-variant tables (`chunk_events`, `tool_call_events`, `plan_events`, etc.). All 11 `SessionUpdate` variants are modeled. Opaque nested fields stay JSON; structured fields are decomposed. Property names are snake_case so they map verbatim to SQL.
- `services/engine/src/db/client.ts` — `Db` Effect service with `scoped` lifecycle. Opens `$OAGENT_HOME_DIR/sqlite.db` (default `~/.config/oagent/sqlite.db`) with WAL + foreign_keys + busy_timeout pragmas and runs embedded migrations. Job recovery belongs to `Jobs`, not database acquisition.
- `services/engine/src/config.ts` — Effect-based JSON config loader. Reads `$OAGENT_HOME_DIR/config.json` (default `~/.config/oagent/config.json`), validates via Effect Schema, and returns decoded values. Missing file is normal and yields defaults; malformed files surface as errors. Currently exposes the `portless` boolean.
- `services/engine/src/db/migrate.ts` — Embedded migration runner. Applies pending codegenned SQL files (`scripts/gen-migrations.ts`) one transaction at a time with foreign keys temporarily disabled and checked after each migration.
- `services/engine/src/sessions.ts` — `Sessions` Effect service. Creates sessions before their first job, resolves forks by session/job ID (including earlier-job OpenCode REST checkpoints), starts idle turns, steers busy OpenCode turns, reads the latest turn, cancels, and lists recent sessions with an optional cwd filter.
- `services/engine/src/jobs.ts` — `Jobs` Effect service runs turns for existing session rows. `Jobs.start` reserves a job, forks the selected backend turn into a daemon fiber, and returns a `jobId`; events are written to SQLite in a transaction (base `events` row + variant table). OpenCode message checkpoints are captured when a turn ends. `Jobs.wait` blocks until terminal unless given a timeout for polling. Live SSE fanout uses an in-memory `EventEmitter` keyed by job id; history is read from DB. Jobs persist indefinitely; no sweep. Does not know about MCP or HTTP.
- `services/engine/src/worktree.ts` — `Worktrees` Effect service renders the configured create command, resolves the new branch from Git's worktree listing, and preserves the caller's relative subdirectory; worktrees are retained after jobs finish.
- `services/engine/src/alias-presets.ts` — `AliasPresets` Effect service manages named snapshots, transactional activation/save/discard, and server-side dirty comparison; live `model_aliases` remains the runtime source of truth.
- `services/engine/src/session-costs.ts` — `SessionCosts` computes API-price-equivalent session costs through `ccusage-lib`, deduplicates in-flight scans, and caches token totals and USD cost in SQLite until a newer turn ends. The library downloads and caches its executable at runtime. Codex uses the configured home; Grok and Cursor are unsupported.
- `services/engine/src/opencode.ts` — `OpenCode` Effect service wrapping the opencode ACP subprocess session.
- `services/engine/src/harnesses.ts` — `Harnesses` Effect service that detects, persists, and probes installed ACP harness binaries and manages Codex device-code authentication subprocesses.
- `services/engine/src/http/{sse,wait,spa}.ts` — HTTP response builders. SSE reads history from DB then attaches to the live `EventEmitter` (buffer-then-drain to close the read-then-attach race). Sends `__terminal__` sentinel when the job finishes. Wait blocks via `Jobs.wait` and returns the terminal result as JSON. SPA serves files from the embedded filemap with index.html fallback for client routing.
- `services/engine/src/rpc/router.ts` — oRPC router using `@orpc/experimental-effect`'s builder extensions and native `.effect(...)` handlers. Each handler resolves its Effect services from the request's supplied context, and `EngineRouter` is inferred directly from the router value without explicit output-schema workarounds.
- `services/engine/src/mcp/progress.ts` — shared job-event progress formatting and blocking wait for MCP tools; subscribes to the live job emitter and replays persisted events across the subscribe/read race.
- `apps/cli/src/commands/jobs.ts` — `oagent jobs wait <jobId>` polls in 10-minute chunks (with exponential backoff on transport failures) until the job reaches a terminal status, then prints the shared markdown turn format by default or JSON with `--json`; `oagent jobs list` prints a compact TOON summary by default or JSON with `--format json`.
- `apps/web/src/lib/orpc.ts` — typed oRPC client over `RPCLink` to `/rpc`. In dev Vite proxies to `ENGINE_URL`; in prod served same-origin from the embedded SPA (or `?engine=` query to override).
