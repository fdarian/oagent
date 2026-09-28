# Development

See also: [engine development](../../../services/engine/docs/development.md).

## UI changes: Storybook first

Use Storybook for UI iteration and visual or interaction verification. It runs without an engine, with fixtures and callbacks supplied by stories. From `apps/web`:

```sh
bun storybook --ci
```

Open `http://localhost:6006` or the URL printed by Storybook. `--ci` skips interactive prompts and automatic browser opening, making it suitable for agents.

- Stories live beside components and pages in `src/**/*.stories.tsx`. Use an existing story or add a focused state with fixture data and stubbed callbacks.
- `src/pages/ConsolePage.stories.tsx` demonstrates composed page layouts; `src/components/job-timeline.stories.tsx` covers timeline states.
- `.storybook/preview.ts` loads app styles and shared theme/router providers from `.storybook/with-app-providers.tsx`. Keep stories independent of live engine requests.
- Use the full app when verification needs real RPC, persistence, SSE, or an end-to-end flow.

## Full app: local engine

Start the engine before the web. Use separate terminals or background processes; each `cd` below is from the repo root.

1. Start the isolated development engine and wait for its listening log:

   ```sh
   cd services/engine
   bun dev
   ```

2. Start the web against that engine:

   ```sh
   cd apps/web
   bun dev --local engine
   ```

Agents should start the processes they need, or reuse ones already running for this checkout.

`--local engine` discovers the URL from `services/engine/.data/running.json` and sets `ENGINE_URL` for Vite's `/rpc` and `/jobs` proxies. The web script waits for the signal if it is absent. The engine runs the current source with its own development config, database, and logs. Both processes reload on source changes.

### Find the running URLs

Both dev servers use per-session sticky ports. Read the signals from the repo root:

```sh
cat services/engine/.data/running.json
cat apps/web/.data/running.json
```

Each file contains a `url` field. Open the **web** URL in the browser; use the engine URL for RPC or MCP clients. The web signal is published after Vite responds, and Vite uses `--strictPort` so the published port matches the server. Signals are removed on shutdown. Stop each foreground process with Ctrl-C when finished.

## Inspecting the user's running app

For a deliberate UI-only check against existing, data-rich sessions, run this from `apps/web`:

```sh
bun dev
```

This targets `http://localhost:17777`, the user's running engine. It does not run engine source from this checkout, so new or changed oRPC procedures can be missing or stale. Any mutation affects the user's running app.

Use the local-engine workflow for engine changes, mutation testing, or setting up specific cases, including UI cases that need controlled data. Prefer Storybook when fixture data can represent the state being tested.

## Custom engine URL

The dev wrapper sets `ENGINE_URL` itself. To target a specific engine directly, bypass it from `apps/web`:

```sh
ENGINE_URL=http://localhost:18000 pnpm vite
```

This runs Vite with a custom proxy target, without dev-session port management or a web running signal. Read Vite's printed URL.

## Environment variable

| Variable     | Default                  | Description                        |
| ------------ | ------------------------ | ---------------------------------- |
| `ENGINE_URL` | `http://localhost:17777` | Engine base URL used by Vite's `/rpc` and `/jobs` proxies; set by the dev wrapper, or explicitly when running Vite directly |
