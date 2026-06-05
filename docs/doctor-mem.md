# Diagnosing memory usage

`oagent doctor mem` breaks down how much memory `oagent serve` and everything it spawns are actually using. macOS only — it relies on the `footprint(1)` tool.

Reach for it when a process monitor (Activity Monitor, iStat Menus, `top`) shows "oagent" using multiple gigabytes and you want to know where that memory is. The headline is almost always the same: the oagent server itself is small, and the bulk is the `opencode` subprocess plus the language servers and MCP servers OpenCode spawns underneath it.

## Usage

```sh
oagent doctor mem
```

```
oagent server core: 86.0 MB phys · full tree: 253.2 MB RSS / 2.6 GB phys (incl. compressed)

The oagent server process itself is small; most memory is the opencode ACP
subprocess and the language servers / MCP servers it spawns. Activity Monitor
and iStat Menus report phys_footprint (resident + compressed pages), which is
larger than RSS under memory pressure.

## Server process tree

| Group                       | Count | RSS      | phys     |
| --------------------------- | ----: | -------: | -------: |
| expect-cli (mcp)            |     6 |   1.1 MB | 930.0 MB |
| typescript tsserver         |     4 |   4.3 MB | 868.0 MB |
| opencode acp                |     1 | 121.0 MB | 351.0 MB |
| biome lsp-proxy             |    12 | 384.0 KB | 137.4 MB |
| oagent serve                |     1 | 103.2 MB |  86.0 MB |
| ...                         |       |          |          |

### Process hierarchy

oagent serve (pid 45525) — 116.3 MB RSS · 88.0 MB phys
├─ opencode acp (pid 45563) — 244.4 MB RSS · 348.0 MB phys
│  ├─ expect-cli (mcp) (pid 19374) — 368.0 KB RSS · 207.0 MB phys
│  ├─ typescript-language-server (pid 66356) — 3.4 MB RSS · 25.0 MB phys
│  │  └─ typescript tsserver (pid 66440) — 2.4 MB RSS · 463.0 MB phys
│  │     └─ typescript typingsInstaller (pid 66443) — 2.1 MB RSS · 43.0 MB phys
│  └─ biome lsp-proxy (pid 51497) — 64.0 KB RSS · 13.0 MB phys
└─ cursor-agent acp (pid 45564) — 448.0 KB RSS · 110.0 MB phys

Total: 253.2 MB RSS · 2.6 GB phys
```

Pass `--json` to emit the full structured report (per-process pids, commands, byte counts, and totals) instead of the human-readable table — useful for piping or attaching to a bug report.

The command is read-only. It runs `ps` and `footprint` and never touches the running server, so it is safe to run against a live `oagent serve`.

## Reading the output

- **RSS** — resident memory, the pages currently in physical RAM.
- **phys** (`phys_footprint`) — resident *plus* compressed pages. This is the number Activity Monitor and iStat Menus report, and under memory pressure macOS compresses idle pages, so phys can be several times larger than RSS.
- **Server process tree** — the live `oagent serve` process and every descendant, grouped by command. Duplicate language servers (one set per worktree OpenCode has touched) accumulate here and are the usual source of a large total.
- **Process hierarchy** — the same processes drawn as a tree, so you can see which process spawned which (e.g. `opencode acp` → `typescript-language-server` → `tsserver`). Siblings are ordered by phys, heaviest first.
- **Other oagent processes** — `oagent jobs wait`, `oagent stdio`, and similar processes not under the live server.
- **Possibly-orphaned opencode** — `opencode` processes reparented to launchd (`ppid` 1), i.e. leaked from an oagent session that has since exited. A non-empty section here is worth a closer look.

If no `oagent serve` process is running, the command says so and still reports any other-oagent or orphaned-opencode processes it finds.
