# opencode acp swallows provider errors as `end_turn`

## Symptom

When `opencode_start` is called with an invalid model id (e.g. `opencode-go/qwen-3.6-plus`, where the real id is `qwen3.6-plus` with no dash), the calling agent receives:

```json
{ "status": "done", "sessionId": "ses_…", "text": "", "stopReason": "end_turn" }
```

…even though opencode internally hits a `ProviderModelNotFoundError`. The error appears only on the console (oagent inherits opencode's stderr):

```
ProviderModelNotFoundError: ProviderModelNotFoundError
 data: {
  providerID: "opencode-go",
  modelID: "qwen-3.6-plus",
  suggestions: [],
},

      at <anonymous> (/$bunfs/root/chunk-zwcr62wj.js:779:47377)
      at ~effect/Effect/successCont (…)
      …
```

## Root cause

Verified empirically with `/tmp/oagent-acp-probe/probe.ts` (talks ACP directly to `opencode acp`, opencode 1.14.29, ACP SDK 0.20.0):

1. `session/setSessionConfigOption` with an unknown model **resolves successfully** — opencode stores `currentValue: "opencode-go/qwen-3.6-plus"` as-is, with no validation against its own option catalog.
2. `session/prompt` **resolves successfully** with `{ stopReason: "end_turn", _meta: {} }`.
3. Zero session updates emitted during the prompt (no `agent_message_chunk`, no `tool_call_update` with a failed status).
4. The `ProviderModelNotFoundError` is written only to opencode's stderr.

ACP itself has no transport for this:

- `PromptResponse` (schema/types.gen.d.ts:3394) carries only `stopReason` + optional `usage`/`userMessageId`. No error field.
- `StopReason` is `"end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"`. None of these mean "agent failed". `refusal` is for content-policy refusals.
- `SessionUpdate` (schema/types.gen.d.ts:4332-4352) has no error variant. `tool_call_update` with `status: failed` only fires for tool failures, not for model-resolution failures.

The protocol's intended path is for the agent to reject the `session/prompt` JSON-RPC call with an `ErrorResponse` (jsonrpc.d.ts:25 — `{ code, message, data }`). Our `Effect.tryPromise` around `conn.prompt()` in `services/engine/src/opencode.ts` already catches that path and emits `OpenCodeTurnFailed`, which `Jobs` then records as `status: 'error'`. But because opencode resolves the call instead of rejecting, we never enter that branch.

## Why this is an opencode bug

`session/prompt` for a session whose configured model can't be resolved should reject with a JSON-RPC error so clients can surface it. Today opencode catches the error internally, emits no session update, and returns `end_turn` with empty content — indistinguishable from a successful no-op turn.

File upstream against opencode.

## Workaround on our side (until upstream fix)

Capture opencode's stderr instead of inheriting it. In `services/engine/src/opencode.ts`:

- Switch `stderr: 'inherit'` → `'pipe'`, drain it into a buffer (also tee back to our own stderr so the user keeps the nice console log).
- Track a per-runTurn capture window: when a turn starts, mark the current stderr offset; when it ends, slice the buffer from that offset.
- After the prompt resolves: if `text === ''` AND `stopReason === 'end_turn'` AND the captured slice contains an error, fail the turn with `OpenCodeTurnFailed({ code: 'OPENCODE_INTERNAL', message: <captured stderr> })` instead of returning success. `Jobs.tapError` will then record `status: 'error'` and `wait` returns the message to the calling agent.

Caveat: stderr is per-process, not per-session. If multiple turns ever run concurrently against the same opencode subprocess, attribution will smear. Today's usage is mostly serial; if/when concurrency becomes real, revisit.

## Repro

```sh
cd /tmp/oagent-acp-probe   # probe.ts + package.json with @agentclientprotocol/sdk@0.20.0
bun install
bun probe.ts
```

Expected output snippets:

```
setSessionConfigOption RESOLVED: {"configOptions":[…"currentValue":"opencode-go/qwen-3.6-plus"…]}
prompt RESOLVED: {"stopReason":"end_turn","_meta":{}}
count: 1   # only the available_commands_update from session creation
=== stderr captured (last 1500 chars) ===
ProviderModelNotFoundError: ProviderModelNotFoundError
 data: { providerID: "opencode-go", modelID: "qwen-3.6-plus", suggestions: [] },
…
```
