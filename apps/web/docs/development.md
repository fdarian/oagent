# Development

See also: [engine dev](../../services/engine/docs/development.md).

## Running

```sh
bun dev
```

Starts Vite on `:5173`. `apps/web/scripts/dev.ts` polls `services/engine/.data/dev.json` (up to 30 seconds, 250 ms interval) to discover the engine URL, then sets `ENGINE_URL` before invoking Vite. Start the engine first — the web script will wait.

If the engine does not start within 30 seconds, the script prints an error and exits 1.

To run Vite in true standalone mode without the engine (bypassing the polling wrapper):

```sh
ENGINE_URL=http://localhost:18000 bunx vite
```

## Environment variables

| Variable     | Default                  | Description                        |
| ------------ | ------------------------ | ---------------------------------- |
| `ENGINE_URL` | `http://localhost:17777` | Engine base URL used by Vite proxy |
