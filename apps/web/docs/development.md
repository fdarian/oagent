# Development

## Running

```sh
bun dev
```

Starts Vite on `:5173`. Proxies `/rpc` and `/jobs` to the engine (defaults to `http://localhost:17777`).

Set `ENGINE_URL` if the engine is running on a different port:

```sh
ENGINE_URL=http://localhost:18000 bun dev
```

## Environment variables

| Variable     | Default                  | Description                        |
| ------------ | ------------------------ | ---------------------------------- |
| `ENGINE_URL` | `http://localhost:17777` | Engine base URL used by Vite proxy |
