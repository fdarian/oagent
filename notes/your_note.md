# Removing acpx, going direct to ACP

## Why

`acpx` (currently `acpx@0.6.1`) wraps the ACP transport (`@agentclientprotocol/sdk@0.20.0`) and gives us:

- Process management — spawns `opencode acp` and pipes JSON-RPC.
- Session store — `createFileSessionStore({ stateDir })`.
- Agent registry — `createAgentRegistry({ overrides })`.
- Permission policy — `permissionMode: 'approve-all'` etc.
- A `runTurn` / `startTurn` API with a clean event AsyncIterable + result Promise.

But it normalizes every ACP `session/update` notification into a flat union (`AcpRuntimeEvent`) with only 3 streaming variants — `text_delta`, `status`, `tool_call` — and drops most ACP fields. The web UI consumes that flattened stream via `apps/web/src/lib/event-adapter.ts`. The mismatch is what's been forcing kludges in the adapter.

## What acpx drops vs. raw ACP

ACP `SessionUpdate` (per `@agentclientprotocol/sdk@0.20.0/schema/schema.json`) has 11 kinds. acpx collapses them into 3:

| ACP kind | acpx maps to | What's lost |
|---|---|---|
| `agent_message_chunk` | `text_delta` (stream: `output`) | `messageId` (groups chunks into one message), `ContentBlock` shape (image/audio/resource not just text) |
| `agent_thought_chunk` | `text_delta` (stream: `thought`) | `messageId` (groups chunks into one thought) |
| `tool_call` (create) | `tool_call` (text snapshot) | `kind` (read/edit/execute/search/think/fetch — for icons), `content[]`, `locations[]`, `rawInput`, `rawOutput`. acpx synthesizes a string body like `"bash (pending): rg …"` |
| `tool_call_update` | `tool_call` (same shape, same toolCallId) | Same fields as create. `text` is a fresh full snapshot, not a delta — the adapter must replace, not append (see `ca3aff4`) |
| `plan` | — | Dropped entirely (todo-list rendering not possible) |
| `available_commands_update` | — | Dropped (slash-command UI not possible) |
| `current_mode_update` | — | Dropped (mode pill not possible) |
| `config_option_update` | — | Dropped |
| `session_info_update` | — | Dropped (title, timestamps) |
| `usage_update` (UNSTABLE) | — | Dropped (token/cost display not possible) |
| `user_message_chunk` | — | Dropped (echo of user text) |

acpx also emits `status` events (its own thing — progress strings; not in ACP) and `done`/`error` compatibility events.

## Kludges currently in `apps/web/src/lib/event-adapter.ts`

1. **Tool-body replace-vs-append** (`ca3aff4`). Because acpx re-emits a full `text` snapshot per update with the same `toolCallId`, the reducer was concatenating `"bash (pending)"` + `"bash (in_progress)"`. Going direct to ACP, `tool_call_update.content` is an explicit array that REPLACES (per spec); no string-concat heuristic needed.
2. **Reasoning grouping by status-event boundary** (`c11d38a`). Without `messageId` we can't reliably group `agent_thought_chunk`s into one logical thought block — currently we accumulate consecutive `text_delta(stream:'thought')` until any non-thought / non-status event arrives. That is a heuristic; the canonical grouping is `messageId`. Same applies to `agent_message_chunk`.
3. **No tool icons / kind**. `JobTimelineTool` shows a generic wrench because `kind` is unavailable.
4. **No `ContentBlock` rich content**. Only plain text renders; image/audio/resource blocks would silently fall through.

## Migration sketch

### Files that change

- `services/engine/src/opencode.ts` — currently uses `createAcpRuntime` from `acpx/runtime`. Replace with direct `@agentclientprotocol/sdk` client wired to a `stdio` transport spawning `opencode acp`.
- `services/engine/src/jobs.ts` — the `Jobs` service stores `AcpRuntimeEvent`s in its 200-event ring buffer. Replace the event type with raw ACP `SessionNotification['params']['update']` (the discriminated union of all 11 kinds). The ring buffer logic itself is acpx-agnostic.
- `services/engine/src/http/sse.ts` — JSON-encodes events to the wire. No semantic change; just the type widens.
- `apps/web/src/lib/event-adapter.ts` — biggest rewrite. Switch the input type from `AcpRuntimeEvent[]` to `SessionUpdate[]`. Use `messageId` for thought/message grouping. Use `tool_call_update.content`/`locations` semantics (REPLACE) instead of string snapshots. Add `kind` to the `tool` `TimelinePart` for icon dispatch.
- `apps/web/src/components/job-timeline-tool.tsx` — render by `kind` (read/edit/execute/search/think/fetch icons). Render `content[]` (which can be diffs, code, terminal output) and `locations[]` (file/line refs) instead of a single `body` string.
- New: `apps/web/src/components/job-timeline-plan.tsx` — render the `plan` update.
- New: usage strip / mode pill components if those updates are surfaced.

### What needs replacing for the things acpx provides

| acpx capability | Replacement |
|---|---|
| `createAgentRegistry({ overrides: { opencode: 'opencode acp' } })` | Spawn `opencode acp` directly via Bun. Use `Bun.spawn` with stdin/stdout pipes. |
| `createFileSessionStore({ stateDir })` | If session resume across server restarts is still needed, a small JSON-file store keyed by `sessionId`. Otherwise drop — opencode's own `--continue` / `--session` flags can carry resume state. |
| `permissionMode: 'approve-all'`, `nonInteractivePermissions: 'fail'` | Implement an ACP `Client` with `requestPermission` returning `outcome: { kind: 'selected', optionId: 'allow_always' }` (or always `cancelled` for non-interactive). Per ACP spec, the client owns the permission UI/policy. |
| `runTurn` / `startTurn` lifecycle | Drive the JSON-RPC `session/new`, `session/prompt`, and listen for `session/update` notifications + the `session/prompt` response (which carries `stopReason`). |
| `ensureSession` with `resumeSessionId` | `session/load` ACP method (if `loadSession` capability is advertised) or `session/new`. |
| `setConfigOption({ key, value })` | ACP `session/set_model` / `session/set_mode` methods (check what opencode advertises in its `ConfigOptionUpdate` schema). |
| `cancel` | ACP `session/cancel` notification + locally mark non-finished tool calls cancelled. |
| `close` with `discardPersistentState` | ACP doesn't have a generic close; opencode rejects discard. So just shut down the stdio transport. |

### Reference points

- ACP schema: `node_modules/.bun/@agentclientprotocol+sdk@0.20.0+*/node_modules/@agentclientprotocol/sdk/schema/schema.json`
- ACP TypeScript types: `node_modules/.bun/@agentclientprotocol+sdk@0.20.0+*/node_modules/@agentclientprotocol/sdk/dist/*.d.ts`
- acpx runtime types (current shape we're replacing): `node_modules/.bun/acpx@0.6.1/node_modules/acpx/dist/runtime.d.ts`
- acpx normalization (the source of the snapshot-string format): `node_modules/.bun/acpx@0.6.1/node_modules/acpx/dist/runtime.js`, function `createToolCallEvent`

### Validation

- `bun --filter @oagent/web check` and `bun --filter @oagent/engine check`
- `bun --filter @oagent/web run build-storybook` — the storybook stories construct `TimelinePart` values directly, so type-widening will require touching them too.
- Manual: run a turn against opencode kimi-k2.6 and verify: thoughts group, tool body shows the actual tool I/O (not the synthesized status string), kind icons appear, plan/mode/usage render if surfaced.

### Order of attack

1. Land the type rewrite first — `event-adapter.ts` switched to `SessionUpdate` input, with the engine still bridging from acpx temporarily (acpx → SessionUpdate adapter as a compat shim). All UI code becomes ACP-native.
2. Replace `services/engine/src/opencode.ts` with a direct ACP client; delete the compat shim. Drop `acpx` from `package.json`.
3. Add new UI surfaces (plan, mode, usage, tool kinds) one at a time.

## Out of scope for the cleanup

- Don't touch DESIGN.md tokens or styling. The shadcn/`@theme` swap from the recent kimi pass should remain.
- Don't reintroduce a string-based tool body. The point of going direct is structured tool content.
