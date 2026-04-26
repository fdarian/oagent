import { BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';

const program = Effect.gen(function* () {
  yield* Effect.logInfo('opencode-mcp scaffold — implementation pending');
});

BunRuntime.runMain(program);
