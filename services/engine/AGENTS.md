# @oagent/engine

## Testing

vitest + @effect/vitest, run with `bun -b vitest run` (the `-b` is required for `bun:sqlite`). Tests in `test/`, helpers in `test/helpers/`.

For `Jobs` integration tests, reuse `test/helpers/jobs-test-layer.ts` — `jobsTestLayer(openCodeLayer)` wires `Jobs` with an isolated DB (`test/helpers/db.ts`) and inert cursor/grok stubs; feed it a fake OpenCode from `test/helpers/fake-opencode.ts`. Don't rewire `Jobs` by hand, and never touch the live engine / real DB / real OpenCode.
