# oagent

## 0.2.1

### Patch Changes

- 9af297d: Ad-hoc sign the macOS release binaries so Apple Silicon no longer SIGKILLs the CLI on launch. Cross-compiled darwin binaries built on the Ubuntu runner had an invalid signature; they are now re-signed (rcodesign on CI, codesign locally) before packaging.

## 0.2.0

### Minor Changes

- 37733ef: Prepare the first publishable `oagent` release with an npm launcher, GitHub release binaries, and Homebrew automation.
