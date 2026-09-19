# oagent

## 0.4.0

### Minor Changes

- 4768edb: `steer` tool to send message mid-turns

### Patch Changes

- d65bcab: Clearer error message and show binary path
- d4eb034: Persist harness versions and use version-aware OpenCode model discovery.
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
