---
name: oagent-testing
description: How to write and run tests in the oagent monorepo (vitest + @effect/vitest under bun). Use when adding or modifying tests in services/engine or apps/cli, setting up a test for an Effect service, or testing DB/Jobs/SSE/channel code.
---

## Framework + how to run

- **vitest** + **@effect/vitest** (Effect-native assertions + `it.effect`).
- Tests MUST run under **Bun** because of native `bun:sqlite` resolution. The `-b` flag is mandatory.
  - Per-package:
    - `cd services/engine && bun -b vitest run`
    - `cd apps/cli && bun -b vitest run`
  - Root (via turbo): `bun run test`
  - Watch mode: `bun -b vitest`

## Layout

- Tests live in `<package>/test/**/*.test.ts`.
- Shared helpers in `<package>/test/helpers/`.
- Each package has its own `vitest.config.ts` at the package root.

The config needs a custom `sqlTextPlugin` because migrations embed SQL via Bun's `import ... with { type: 'text' }`, which Vite does not understand natively:

```ts
// services/engine/vitest.config.ts  (same pattern in apps/cli)
import fs from 'node:fs';
import { defineConfig } from 'vitest/config';

const sqlTextPlugin = () => ({
	name: 'sql-text-import',
	load(id: string) {
		if (!id.endsWith('.sql')) return;
		return `export default ${JSON.stringify(fs.readFileSync(id, 'utf-8'))}`;
	},
});

export default defineConfig({
	plugins: [sqlTextPlugin()],
	test: { include: ['test/**/*.test.ts'] },
});
```

## The @effect/vitest idiom

Import from `@effect/vitest` (not plain vitest) and return an `Effect` from `it.effect`:

```ts
import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

describe('something', () => {
	it.effect('does a thing', () =>
		Effect.gen(function* () {
			// ... use services via yield*
			expect(value).toBe(expected);
		}).pipe(Effect.provide(someLayer)),
	);
});
```

- `it.effect` provides a `TestContext` with `TestClock` frozen at 0.
- Use **`it.live`** or **`it.scopedLive`** when you need real wall-clock / timeouts / fibers (e.g. SSE stream tests).
- Remember to add **`Effect.scoped`** when the test stack includes scoped layers (like `testDbLayer`).

Canonical simple example: `services/engine/test/session-events-roundtrip.test.ts`

## Isolated DB

Never let tests touch `~/.config/oagent/sqlite.db`. Use the scoped helper:

```ts
import { testDbLayer } from './helpers/db.ts';
```

`testDbLayer` (defined in `services/engine/test/helpers/db.ts`) creates a temp SQLite file under `os.tmpdir()`, runs migrations + orphan recovery on acquire, and deletes the DB (plus WAL/SHM) on release.

It works by overriding `OAGENT_DB_PATH` via `Layer.setConfigProvider` before providing `Db.Default`. The seam is `services/engine/src/db/path.ts`, which reads `OAGENT_DB_PATH` from Effect Config and falls back to the real user path only when unset.

Usage:

```ts
it.effect('round-trips through SQLite', () =>
	Effect.gen(function* () {
		const { db } = yield* Db;
		// ... insert, assert
	}).pipe(Effect.provide(testDbLayer)),
);
```

## Testing Jobs / services that need OpenCode

Do **not** use the real `OpenCode` service (that spawns a subprocess). Inject the fake layer instead:

```ts
import { scriptedFakeOpenCodeLayer, failingFakeOpenCodeLayer, gatedFakeOpenCodeLayer } from './helpers/fakeOpenCode.ts';
import { jobsTestLayer } from './helpers/jobsTestLayer.ts';
import { Jobs } from '../src/jobs.ts';
```

- `jobsTestLayer(fakeOpenCodeLayer)` wires `Jobs` with `testDbLayer`, the injected fake `OpenCode`, and inert stubs for `Cursor` and `Grok`.
- Requires `Effect.scoped` because `testDbLayer` is scoped.

```ts
it.effect('completes with scripted events', () =>
	Effect.gen(function* () {
		const jobs = yield* Jobs;
		const { jobId } = yield* jobs.start({ ... });
		const result = yield* jobs.wait({ jobId, timeoutMs: 10_000 });
		expect(result.status).toBe('done');
	}).pipe(
		Effect.provide(jobsTestLayer(scriptedFakeOpenCodeLayer({ events: [...], result: {...} }))),
		Effect.scoped,
	),
);
```

Canonical examples:
- `services/engine/test/jobs-lifecycle.test.ts` — scripted events, error path, orphan recovery
- `services/engine/test/sse-fanout.test.ts` — SSE buffer-then-drain, `it.scopedLive`, gated fake OpenCode

## Testing apps/cli / the channel bridge

The `channel.ts` module imports `@oagent/engine`, which pulls in `bun:sqlite` and breaks vitest in the cli package. Instead, import the **pure, injectable** module:

```ts
import { channelEventFor, waitForTerminalAndNotify } from '../src/lib/channel-waiter.ts';
```

`channel-waiter.ts` exports pure functions with no Effect service dependencies. Pass in stubbed `fetchSse`, `waitJob`, and `notify` in tests.

Canonical example: `apps/cli/test/channel-waiter.test.ts`

## ⛔ ISOLATION RULE

Tests must **never** touch live infrastructure. A past run polluted the user's real `~/.config/oagent/sqlite.db` by doing the things listed below. Do not repeat this.

- **Never call the live engine.** Do not hit `localhost:17777` or whatever `$OPENCODE_MCP_PORT` points to.
- **Never use `Db.Default` without `testDbLayer`.** If you need `Db`, always provide `testDbLayer` (or an equivalent scoped override of `OAGENT_DB_PATH`).
- **Never use the real `OpenCode` service.** Do not spawn the opencode subprocess in tests. Always inject `fakeOpenCode` via `jobsTestLayer`.
- **For engine integration tests, stand up an isolated in-process engine.** Use `createServer({ port: 0 })` from `services/engine/src/server.ts` with `testDbLayer` + fake OpenCode. Do not rely on the user's running engine.
- **Do not manually probe the live MCP to "understand" behavior.** Read the source instead.

## Gotchas checklist

- Run `bun run check:type` (or `tsgo --noEmit`) even if tests pass. The Bun runtime is loose; `tsgo` is strict. Tests can pass at runtime but fail typecheck.
- Avoid `any` and non-null assertions (`!`).
- `tool_call.content` is stored in DB but **not rehydrated** on read — do not assert on it after round-tripping.
- Format with `biome check --write` (tabs, not spaces).
- Watch mode: `bun -b vitest` (per-package) or check each package's `package.json` for `test:watch`.
