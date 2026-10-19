---
"oagent": minor
---

Claude jobs now stay running while the background shell commands they started finish (up to `claudeBackgroundHoldMinutes` in `config.json`, default 30), and report the follow-up result.
