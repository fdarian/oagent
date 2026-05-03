# Migration plan: drop `acpx`, go direct to `@agentclientprotocol/sdk`

Companion to `notes/your_note.md`. This file captures the research output so the next session can resume without re-exploring.

## Confirmed facts (from source reads)

### `@agentclientprotocol/sdk@0.20.0` — runtime API surface

`ClientSideConnection` (from `dist/acp.js`) exposes these instance methods (verified by reading the JS, not just `acp.d.ts` which under-documents them):

- `initialize(InitializeRequest)`
- `newSession(NewSessionRequest)` — returns `{sessionId, configOptions?, models?, modes?}`
- `loadSession(LoadSessionRequest)` — gated on agent advertising `loadSession` capability
- `unstable_forkSession`, `listSessions`, `resumeSession`, `closeSession`
- `setSessionMode({sessionId, modeId})` — `session/set_mode`
- `unstable_setSessionModel({sessionId, modelId})` — `session/set_model`
- `setSessionConfigOption({sessionId, configId, value})` — `session/set_config_option`. Two variants:
  - boolean: `{type:'boolean', value:boolean, configId, sessionId}`
  - select: `{value: string, configId, sessionId}` (no `type` field)
- `authenticate`, `unstable_logout`
- `prompt(PromptRequest)` → `{stopReason, usage?, userMessageId?}`
- `cancel(CancelNotification)` — fire-and-forget
- `extMethod`, `extNotification`

`Stream` plumbing: `ndJsonStream(output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>): Stream`. Constant `PROTOCOL_VERSION = 1`.

Key wire types (from `dist/schema/types.gen.d.ts`):

- `SessionNotification = {sessionId, update: SessionUpdate}` — what `client.sessionUpdate` receives.
- `SessionUpdate` — 11-variant discriminated union keyed by `sessionUpdate` (see `your_note.md` table).
- `ContentChunk = {content: ContentBlock, messageId?: string|null}` — base for `*_chunk` variants.
- `ContentBlock = TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource` keyed by `type`.
- `ToolCall = {toolCallId, title, status?, kind?: ToolKind, content?: ToolCallContent[], locations?: ToolCallLocation[], rawInput?, rawOutput?}`.
- `ToolCallUpdate = {toolCallId, title?, status?, kind?, content?, locations?, ...}` — `content`/`locations`, when provided, **REPLACE** existing arrays.
- `ToolCallStatus = "pending" | "in_progress" | "completed" | "failed"`.
- `ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other"`.
- `ToolCallContent = (Content & {type:'content'}) | (Diff & {type:'diff'}) | (Terminal & {type:'terminal'})`.
- `Diff = {path, oldText?, newText}`. `Terminal = {terminalId}`.
- `ToolCallLocation = {path, line?: number}`.
- `RequestPermissionOutcome = {outcome:'cancelled'} | {outcome:'selected', optionId}`.
- `PermissionOption.kind = "allow_once" | "allow_always" | "reject_once" | "reject_always"`.
- `StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"`.
- `SetSessionConfigOptionRequest`: see above.

### What acpx currently does (from reading `acpx/dist/*`)

- **Spawn**: `node:child_process.spawn(spawnCommand, args)` with stdin/stdout/stderr piped, then wraps with `Writable.toWeb(stdin)` / `Readable.toWeb(stdout)` to feed `ClientSideConnection`. **One subprocess per `AcpClient`** (i.e. per oagent server lifetime, not per turn).
- **`initialize` payload**:
  ```js
  {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: this.options.terminal !== false  // default true
    },
    clientInfo: { name: "acpx", version: "0.1.0" }
  }
  ```
- **Client handlers registered**: `sessionUpdate`, `requestPermission`, `readTextFile`, `writeTextFile`, `createTerminal`, `terminalOutput`, `waitForTerminalExit`, `killTerminal`, `releaseTerminal`. **All 9.** Opencode actively calls `fs/read_text_file`, `fs/write_text_file`, and `terminal/*` — omitting them gives `methodNotFound` mid-turn.
- **`setConfigOption({key:'model', value})`** → `connection.setSessionConfigOption({sessionId, configId: 'model', value})`. So `configId='model'` is correct.
- **Permission policy `'approve-all'`**: prefer `allow_once` or `allow_always`; if neither offered, fall back to `options[0].optionId`. Does **not** hardcode `allow_always`.
- **Tool-call event normalization** (the thing we're undoing): `summaryText = status ? \`${title} (${status})\` : title` then `${summaryText}: ${inputSummary}` — the source of `"bash (pending): rg ..."`.
- **Subprocess teardown**: SIGTERM, grace window, then SIGKILL on `runtime.close()`.

### oagent code shape

- `services/engine/src/opencode.ts` — only file constructing the runtime. Two error tags (`OpenCodeSessionError`, `OpenCodeTurnFailed`).
- `services/engine/src/jobs.ts` — only consumer of `AcpRuntimeEvent` (the type). Re-exports it for the rpc layer. Ring buffer (200) + `EventEmitter` per job + ndjson per job.
- `services/engine/src/rpc/router.ts` — declares a Valibot `acpEventSchema` mirroring the 5-variant flattened union, used in `jobs.get` output for `recentEvents`. **No web consumer of `recentEvents` via RPC** (verified by grep). SSE replays the ring buffer separately. Safe to drop `recentEvents` from the RPC schema entirely.
- `services/engine/src/http/sse.ts` — uses `detail.recentEvents` for replay; needs no semantic change, type widens.
- `services/engine/src/index.ts` — barrel-style exports. Add `export type { SessionUpdate } from '@agentclientprotocol/sdk'` here.
- `apps/web/src/lib/event-adapter.ts` — defines `AcpEvent` type internally (mirror of acpx output). Defines public `TimelinePart` and `reduceEvents`.
- `apps/web/src/lib/use-job-events.ts` — reads SSE, calls `reduceEvents`, exposes `{parts, lastStatus, terminal}`. `terminal` flag set on either `__terminal__` SSE sentinel **or** `terminalReason !== undefined` from adapter (redundant; SSE sentinel is authoritative).
- `apps/web/src/components/job-timeline-tool.tsx` — renders `part.body` as a single `CodeBlock`. Must change to render `content[]`.
- Components depending on `TimelinePart`: `job-timeline.tsx`, `job-timeline-{message,reasoning,error,tool}.tsx`, plus 4 `*.stories.tsx` files (`job-timeline.stories.tsx`, `job-timeline-tool.stories.tsx`, `job-timeline-reasoning.stories.tsx`, `pages/ConsolePage.stories.tsx`). Reasoning/text/error stories don't break; tool stories do.
- `apps/web` does **not** import any acpx symbol directly.

## Decisions (locked in for kimi to follow)

1. **Persistent connection** — match acpx. One `ClientSideConnection` for the OpenCode service lifetime; `session/new` per turn. Use `Effect.acquireRelease` inside the service `effect` so the connection ties to the layer scope.
2. **Client surface**: `clientCapabilities = {fs:{readTextFile:true, writeTextFile:true}, terminal:false}`. Implement `readTextFile`/`writeTextFile` against the local filesystem (Bun.file / Bun.write). **Do not** register `createTerminal` / `terminalOutput` / `waitForTerminalExit` / `killTerminal` / `releaseTerminal` — with `terminal:false` advertised, opencode runs shell tools internally in its own process. This is correct for the oagent topology (Claude Code → oagent → OpenCode); oagent is a passive transport for shell, not a delegate.
   - User decision (resumed session): locked in `terminal: false`. Reasoning: declaring `terminal:true` with stub handlers would tell OpenCode "delegate shell to me" and then fail every call. `terminal:false` lets OpenCode keep its existing shell integration unchanged.
3. **Spawn**: `Bun.spawn(['opencode','acp'], {stdin: transform.readable, stdout:'pipe', stderr:'inherit', cwd: process.cwd()})` where `transform = new TransformStream<Uint8Array,Uint8Array>()`. `proc.stdout` is `ReadableStream<Uint8Array>` per `@types/bun@1.3.13`. Pass `transform.writable` and `proc.stdout` straight to `ndJsonStream`.
4. **Per-turn cwd override**: still out of scope (per MVP TODO in current opencode.ts). Connection cwd is `process.cwd()`. `newSession`/`loadSession` carry `input.cwd`.
5. **Model setting**: `setSessionConfigOption({sessionId, configId:'model', value: input.model})`. No fallback chain in v1; if it breaks, we'll inspect `newSession`'s `configOptions` response.
6. **Permission policy**: pick `allow_always` → else `allow_once` → else `cancelled`. Slight tightening of acpx (we don't fall back to first `reject_*`), since "approve-all" should never approve a reject.
7. **Cancellation**: Effect interruption → `AbortSignal` (via `Effect.tryPromise`'s signal arg) → `conn.cancel({sessionId})` + `proc.kill()` if shutting down.
8. **`recentEvents` in RPC**: drop from `jobs.get` output schema. Keep on `jobs.getDetail()` for SSE replay only. Handler must explicitly omit when shaping the RPC response (no destructure — copy fields by name).
9. **`SessionUpdate` re-export**: `services/engine/src/index.ts` adds `export type { SessionUpdate } from '@agentclientprotocol/sdk'`. Web imports types via `@oagent/engine`. No new dep on `apps/web/package.json`.
10. **`TimelinePart` shape change** (tool variant only):
    ```ts
    | {
        kind: 'tool'
        id: string
        toolCallId: string
        title: string
        state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
        toolKind?: ToolKind
        content: ToolCallContent[]   // replaces body: string
        locations: ToolCallLocation[]
        createdAt: number
        durationMs?: number
      }
    ```
    Other variants (`text`, `reasoning`, `error`) **unchanged**. `error` kind retained but no longer emitted by the adapter — engine may emit synthetic error events later.
11. **Status mapping**: `pending→input-streaming`, `in_progress→input-available`, `completed→output-available`, `failed→output-error`.
12. **Chunk grouping**: Use `messageId` when both old and new chunks carry one and they match. Fall back to "consecutive same-kind chunks until a non-chunk event" heuristic (current behavior) when `messageId` is absent. Different `messageId` → flush + start new.
13. **`lastStatus`**: derive from the most recent tool whose state is `input-streaming`/`input-available` (`Running tool: ${title}`); `undefined` otherwise. Removes the dependency on the gone `status` event.
14. **`terminalReason`**: drop from `AdapterResult`. `useJobEvents` already handles the `__terminal__` SSE sentinel; the adapter's terminal signal is redundant.
15. **rpc Valibot schema for events**: not needed (we drop `recentEvents` from RPC). Don't try to mirror `SessionUpdate` in Valibot.

## Implementation order (atomic commits)

1. **Add SDK dep, re-export type, prep**:
   - `services/engine/package.json`: add `"@agentclientprotocol/sdk": "^0.20.0"` (don't drop acpx yet).
   - `services/engine/src/index.ts`: `export type { SessionUpdate } from '@agentclientprotocol/sdk'`.
   - `bun install`.
   - `bun --filter @oagent/engine check` and `bun --filter @oagent/web check` should still pass (acpx still imported).

2. **Engine: rewrite `opencode.ts`** to direct ACP, **widen `jobs.ts`** (`AcpRuntimeEvent` → `SessionUpdate`), **drop `recentEvents` from `rpc/router.ts`** output schema, **delete the `acpEventSchema` Valibot block**. Engine compiles, web compiles (web doesn't import the broken type yet — `event-adapter.ts` uses an internal `AcpEvent` shape).

3. **Web: rewrite `event-adapter.ts`** consuming `SessionUpdate`. New `TimelinePart` tool shape. Drop `terminalReason`. Update `lastStatus` derivation.

4. **Web: rewrite `JobTimelineTool`** to render `content[]` (Content/Diff/Terminal) plus `locations[]`. Use `CodeBlock` for text content with `detectLanguage`; render Diff with a simple `<pre>` showing `oldText`/`newText` (full structured diff UI is follow-up); render Terminal as a `<div>` placeholder showing `terminalId` (real wire-up to terminal/output is follow-up).

5. **Web: update 3 stories** (`job-timeline-tool.stories.tsx`, `job-timeline.stories.tsx`'s `MidTool`/`FullMixed`, `pages/ConsolePage.stories.tsx`'s `RunningSession`) to use `content[]`/`locations[]` instead of `body`. Reasoning/error stories untouched.

6. **Drop acpx**: remove from `services/engine/package.json`, `bun install`. Final `bun check` across the workspace.

After step 6: `bun --filter @oagent/web check`, `bun --filter @oagent/engine check`, and `bun --filter @oagent/web run build-storybook`. Then a manual smoke test against opencode kimi-k2.6 verifying: thoughts group correctly, tool calls show structured content (not the synthesized `"bash (pending): rg ..."` string), `tool_call_update` doesn't double-render content (the bug `ca3aff4` fixed), and locations render.

## Critical risks flagged by advisor

- **fs/* must be implemented or opencode fails**: confirmed acpx implements them; we must too.
- **terminal handling**: advertising `terminal:false` so OpenCode runs shell internally. No client-side handlers needed. (Decision locked — see Decision #2.)
- **Per-turn vs persistent**: chosen persistent (matches acpx).
- **`session/set_config_option` with `configId:'model'`**: matches acpx exactly.
- **`Bun.spawn` typing**: TransformStream stdin pattern verified clean. `proc.stdout` is `ReadableStream<Uint8Array>` in `@types/bun@1.3.13`.

## Code style constraints (from user CLAUDE.md)

- No destructuring (`object.property`, never `const {x} = obj`).
- No fake/dummy fallbacks; throw on unexpected error.
- No `let` for deferred init — encapsulate in a function returning a const.
- `type` over `interface` (unless `extends`).
- No `any`, no `!`. No barrel/index re-exports beyond what the project already has.
- Co-locate types with their function.
- Comments: `/** Brief description */` only when non-obvious; no `@param`/`@returns`.
- Use `bun` to install (no manual `package.json` edits if avoidable; but for this migration we're explicitly swapping the dep).
- Atomic commits per logical change.

## Files touched (for kimi's diff hygiene)

- `services/engine/package.json` (add+drop)
- `services/engine/src/opencode.ts` (full rewrite)
- `services/engine/src/jobs.ts` (type widening)
- `services/engine/src/rpc/router.ts` (drop schema + field)
- `services/engine/src/index.ts` (add re-export)
- `apps/web/src/lib/event-adapter.ts` (full rewrite)
- `apps/web/src/components/job-timeline-tool.tsx` (renderer rewrite)
- `apps/web/src/components/job-timeline-tool.stories.tsx`
- `apps/web/src/components/job-timeline.stories.tsx`
- `apps/web/src/pages/ConsolePage.stories.tsx`
- `bun.lock` (regenerated)

Out of scope (follow-up PRs):
- New UI surfaces: `plan`, `current_mode_update`, `usage_update`, `available_commands_update`.
- Tool kind icons in `JobTimelineTool` (data is captured via `toolKind`, but icon dispatch is follow-up).
- Real `terminal/*` client-side handler implementation (only relevant if we ever flip to `terminal:true`).
- `setSessionConfigOption` fallback to `unstable_setSessionModel`.
- Per-turn `cwd` override.
