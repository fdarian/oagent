# oagent

MCP server that exposes OpenCode to Claude Code as a subagent via ACP, with a React SPA for live job observability.

## Stack

- Bun, TypeScript, Effect.ts
- @modelcontextprotocol/sdk — MCP server implementation
- @agentclientprotocol/sdk — direct ACP session over opencode subprocess
- @orpc/server + ff-effect/for/orpc — typed RPC with Effect-native handlers
- React 19 + Vite + Tailwind v4 — web SPA, embedded into the binary at build time

## Workspace

- `apps/cli` (`@oagent/cli`) — thin binary entry point.
- `apps/web` (`@oagent/web`) — Vite + React SPA; type-imports `EngineRouter` from `@oagent/engine`.
- `services/engine` (`@oagent/engine`) — Effect services (`Jobs`, `OpenCode`), HTTP handlers, oRPC router.

## Dev

```sh
bun dev          # parallel: cli on :17777 + vite on :5173 (proxies /rpc and /jobs to ENGINE_URL ?? :17777)
bun check        # tsc + biome across all packages
bun run build    # vite build → filemap gen → Bun.build({ compile }) → apps/cli/dist/oagent
```

## Architecture

- `apps/cli/src/index.ts` — Effect CLI with `serve` (default, port 17777) and `stdio` subcommands. The `serve` Bun.serve fetch dispatcher routes, in order: `/mcp` → MCP transport, `/rpc/*` → engine oRPC handler, `/jobs/:id/events` → raw SSE, `/jobs/:id/wait` → long-poll JSON (used by `opencode_result` and shell callers), everything else → SPA fallback.
- `apps/cli/scripts/build.ts` — runs `vite build` in `apps/web`, walks `apps/web/dist/`, generates `apps/cli/.gen/web-ui.gen.ts` with `import ... with { type: 'file' }` plus a default-export filemap, then `Bun.build({ compile: true })` listing both entrypoints so assets embed into the standalone binary.
- `services/engine/src/jobs.ts` — `Jobs` Effect service. `Jobs.start` forks `OpenCode.runTurn` into a daemon fiber and returns a `jobId`; `Jobs.wait` blocks up to a timeout and returns `running | done | error`. Each job maintains a 200-event ring buffer and an `EventEmitter` for SSE fanout, plus a per-job ndjson file under `$TMPDIR/oagent-<pid>/jobs/`. Terminal jobs swept after 30min (sweep interval 5min). Does not know about MCP or HTTP.
- `services/engine/src/opencode.ts` — `OpenCode` Effect service wrapping the opencode ACP subprocess session.
- `services/engine/src/http/{sse,wait,spa}.ts` — HTTP response builders. SSE replays the ring buffer on connect then streams live events via the per-job EventEmitter and sends a `__terminal__` sentinel when the job finishes. Wait blocks via `Jobs.wait` and returns the terminal result as JSON. SPA serves files from the embedded filemap with index.html fallback for client routing.
- `services/engine/src/rpc/router.ts` — oRPC router built via `createHandler` from `ff-effect/for/orpc`. Procedures: `jobs.list`, `jobs.get`, `jobs.start`, `jobs.wait`. Output schemas declared explicitly via Valibot — required workaround: without `.output(...)` the inferred output type collapses to `unknown` (conditional union of generic `runEffect` functions defeats TS inference). Exports `type EngineRouter = Effect.Effect.Success<typeof program>` for client-side inference.
- `apps/web/src/lib/orpc.ts` — typed oRPC client over `RPCLink` to `/rpc`. In dev Vite proxies to `ENGINE_URL`; in prod served same-origin from the embedded SPA (or `?engine=` query to override).
