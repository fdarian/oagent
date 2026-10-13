---
"oagent": patch
---

On-demand and `service start` daemons now share one pid file, so `oagent service stop`/`uninstall` stop whichever runs, and `service start` switches a running on-demand daemon to service mode in place.
