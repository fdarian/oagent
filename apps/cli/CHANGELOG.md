# oagent

## 0.4.0

### Minor Changes

- ee11949: Add user-defined descriptions for configured agent types and include them in the web UI and MCP tool descriptions.
- 711a3c9: Add Claude as an ACP backend via @agentclientprotocol/claude-agent-acp adapter. Supports model selection, effort levels, and aliases. Improves generic ACP catalog fallback for model error hints across all backends.
- 56f9131: Expose configured custom agents in session headers and improve agent description display.
- 4768edb: `steer` tool to send message mid-turns
- ff00ba4: Add durable side chats for jobs. Side chats fork the job's ACP session, persist independently, stream their events, and provide a tabbed drawer with a composer for creating, switching, and sending messages.

### Patch Changes

- d65bcab: Clearer error message and show binary path
- d4eb034: Persist harness versions and use version-aware OpenCode model discovery.
- 416c470: Disable OpenCode's interactive question tool on oagent sessions without changing global or project permissions.
- 6a43905: Add per-harness environment variable settings for ACP sessions.

## 0.3.2

### Patch Changes

- 37f2cc7: Allow OpenCode aliases to configure model reasoning effort.

## 0.3.1

### Patch Changes

- c3e5199: Add separate reasoning-effort configuration for Codex aliases.
- ee3b13b: Replace `OAGENT_CONFIG_PATH` and `OAGENT_DB_PATH` with `OAGENT_HOME_DIR`, from which oagent derives its config, database, logs, and service state paths.

## 0.3.0

### Minor Changes

- 09ff46e: Keep `serve` as the foreground logging command, run it quietly in the background with `service start`, and add separate macOS login-item install and uninstall commands.

### Patch Changes

- a136ab5: Fix Codex ACP turns hanging and correctly apply combined model and reasoning selections.

## 0.2.2

### Patch Changes

- 503ae65: Lazily start backend agent subprocesses and auto-release them after 5 minutes idle.

## 0.2.1

### Patch Changes

- 9af297d: Ad-hoc sign the macOS release binaries so Apple Silicon no longer SIGKILLs the CLI on launch. Cross-compiled darwin binaries built on the Ubuntu runner had an invalid signature; they are now re-signed (rcodesign on CI, codesign locally) before packaging.

## 0.2.0

### Minor Changes

- 37733ef: Prepare the first publishable `oagent` release with an npm launcher, GitHub release binaries, and Homebrew automation.
