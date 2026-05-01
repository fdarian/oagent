/// <reference types="bun" />
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  type AcpRuntimeEvent,
  type AcpRuntimeHandle,
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
} from 'acpx/runtime';
import { Effect, Schema } from 'effect';

class OpenCodeSessionError extends Schema.TaggedError<OpenCodeSessionError>()(
  'OpenCodeSessionError',
  { cause: Schema.Defect },
) {}

class OpenCodeTurnFailed extends Schema.TaggedError<OpenCodeTurnFailed>()(
  'OpenCodeTurnFailed',
  {
    code: Schema.optional(Schema.String),
    message: Schema.String,
    cause: Schema.Defect,
  },
) {}

export class OpenCode extends Effect.Service<OpenCode>()('oagent/OpenCode', {
  effect: Effect.gen(function* () {
    // Stable per-process state directory — one session store per server process.
    const stateDir = path.join(os.tmpdir(), `oagent-${process.pid}`);

    const sessionStore = createFileSessionStore({ stateDir });

    // Override the built-in registry entry which resolves to "npx -y opencode-ai acp",
    // using the locally installed binary directly instead.
    const agentRegistry = createAgentRegistry({
      overrides: { opencode: 'opencode acp' },
    });

    // createAcpRuntime is synchronous — one instance, reused across all turns.
    // No hard timeoutMs here; the job/MCP layer handles polling and cancellation.
    // TODO: per-turn cwd override is out of scope for MVP — all turns use server's cwd.
    const runtime = createAcpRuntime({
      cwd: process.cwd(),
      sessionStore,
      agentRegistry,
      permissionMode: 'approve-all',
      nonInteractivePermissions: 'fail',
    });

    const runTurn = (input: {
      prompt: string;
      model?: string;
      sessionId?: string;
      cwd: string;
      onEvent?: (event: AcpRuntimeEvent) => void;
    }) =>
      Effect.acquireUseRelease(
        // Acquire: create or resume the session handle
        Effect.tryPromise({
          try: () =>
            runtime.ensureSession({
              // When resuming: use a fresh sessionKey so acpx takes the loadSession
              // path (matching a key with an existing record is required to skip it).
              sessionKey: randomUUID(),
              agent: 'opencode',
              mode: 'persistent',
              cwd: input.cwd,
              ...(input.sessionId !== undefined
                ? { resumeSessionId: input.sessionId }
                : {}),
            }),
          catch: (cause) => new OpenCodeSessionError({ cause }),
        }),
        // Use: set model (if provided), run the turn, return the result
        (handle: AcpRuntimeHandle) =>
          Effect.gen(function* () {
            const model = input.model;
            if (model !== undefined) {
              yield* Effect.tryPromise({
                try: () =>
                  runtime.setConfigOption({
                    handle,
                    key: 'model',
                    value: model,
                  }),
                catch: (cause) =>
                  new OpenCodeTurnFailed({
                    code: 'SET_CONFIG_OPTION',
                    message: 'setConfigOption failed',
                    cause,
                  }),
              });
            }

            const turn = runtime.startTurn({
              handle,
              text: input.prompt,
              mode: 'prompt',
              requestId: randomUUID(),
            });

            const text = yield* Effect.tryPromise({
              try: async () => {
                let acc = '';
                for await (const event of turn.events) {
                  if (input.onEvent !== undefined) {
                    input.onEvent(event);
                  }
                  if (
                    event.type === 'text_delta' &&
                    event.stream !== 'thought'
                  ) {
                    acc += event.text;
                  }
                }
                return acc;
              },
              catch: (cause) =>
                new OpenCodeTurnFailed({
                  code: 'EVENT_STREAM',
                  message: 'event stream errored',
                  cause,
                }),
            });

            const result = yield* Effect.tryPromise({
              try: () => turn.result,
              catch: (cause) =>
                new OpenCodeTurnFailed({
                  code: 'RESULT_REJECTED',
                  message: 'result promise rejected',
                  cause,
                }),
            });

            if (result.status === 'failed') {
              return yield* Effect.fail(
                new OpenCodeTurnFailed({
                  code: result.error.code,
                  message: result.error.message,
                  cause: result.error,
                }),
              );
            }

            const sessionId = handle.backendSessionId;
            if (sessionId === undefined) {
              return yield* Effect.fail(
                new OpenCodeSessionError({
                  cause: new Error(
                    'backendSessionId missing after successful turn',
                  ),
                }),
              );
            }

            const stopReason =
              result.status === 'completed' || result.status === 'cancelled'
                ? result.stopReason
                : undefined;

            return { sessionId, text, stopReason };
          }),
        // Release: always close the session handle, even on interruption.
        // discardPersistentState:false because opencode doesn't support session/close
        // with state discard (throws ACP_BACKEND_UNSUPPORTED_CONTROL otherwise).
        (handle: AcpRuntimeHandle) =>
          Effect.tryPromise({
            try: () =>
              runtime.close({
                handle,
                reason: 'turn-complete',
                discardPersistentState: false,
              }),
            catch: (cause) => new OpenCodeSessionError({ cause }),
          }).pipe(Effect.orDie),
      );

    return { runTurn };
  }),
}) {}
