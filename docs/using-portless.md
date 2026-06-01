# Using portless

[portless](https://portless.sh) is an optional local reverse proxy that gives oagent a stable named URL (`https://oagent.localhost`) instead of a bare port number.

## Prerequisites

portless must be installed and its proxy must be running before you start oagent:

```sh
npm install -g portless
portless proxy start        # HTTPS on port 443 (default)
```

On first run portless generates a local CA and trusts it — no browser warnings.

## Start oagent with portless

Pass `--portless` to `oagent serve`:

```sh
oagent serve --portless
# oagent listening on http://127.0.0.1:17777/mcp
# oagent accessible at https://oagent.localhost
```

oagent calls `bunx portless alias oagent <port>` after binding, so no `$PATH` dependency on a global install — `bunx` fetches portless on demand if it isn't already cached.

When the process exits the route is removed automatically (`portless alias --remove oagent`).

## Register with Claude Code

```sh
claude mcp add --transport http opencode https://oagent.localhost/mcp
```

## Customising the proxy

If you run the proxy on a non-default port or without TLS, start it explicitly before oagent:

```sh
portless proxy start --no-tls   # HTTP on port 80
oagent serve --portless
# oagent accessible at http://oagent.localhost
```

See `portless --help` or the [portless docs](https://portless.sh) for the full option set.
