---
'oagent': patch
---

Ad-hoc sign the macOS release binaries so Apple Silicon no longer SIGKILLs the CLI on launch. Cross-compiled darwin binaries built on the Ubuntu runner had an invalid signature; they are now re-signed (rcodesign on CI, codesign locally) before packaging.
