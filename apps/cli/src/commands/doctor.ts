import { Command, Options } from '@effect/cli';
import { Effect } from 'effect';
import type { Version } from '#/lib/misc.ts';

type PsProcess = {
	pid: number;
	ppid: number;
	rssKb: number;
	command: string;
};

type ProcessMemory = {
	pid: number;
	ppid: number;
	command: string;
	normalized: string;
	rssBytes: number;
	physBytes: number;
};

type MemoryGroup = {
	label: string;
	count: number;
	rssBytes: number;
	physBytes: number;
};

type ProcessTreeNode = {
	pid: number;
	label: string;
	command: string;
	rssBytes: number;
	physBytes: number;
	children: ReadonlyArray<ProcessTreeNode>;
};

type TreeSection = {
	roots: ReadonlyArray<ProcessMemory>;
	processes: ReadonlyArray<ProcessMemory>;
	tree: ReadonlyArray<ProcessTreeNode>;
	groups: ReadonlyArray<MemoryGroup>;
	totals: { rssBytes: number; physBytes: number };
	serverCore: { rssBytes: number; physBytes: number };
};

type MemReport = {
	serverTree: TreeSection | undefined;
	otherOagent: TreeSection | undefined;
	orphanedOpencode: TreeSection | undefined;
};

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/** Parse `ps -axo pid=,ppid=,rss=,command=` lines. */
function parsePsOutput(raw: string): ReadonlyArray<PsProcess> {
	const lines = raw.split('\n');
	const result: PsProcess[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
		if (match === null) {
			continue;
		}
		const pidStr = match[1];
		const ppidStr = match[2];
		const rssStr = match[3];
		const command = match[4];
		if (pidStr === undefined || ppidStr === undefined || rssStr === undefined) {
			continue;
		}
		if (command === undefined) {
			continue;
		}
		result.push({
			pid: Number.parseInt(pidStr, 10),
			ppid: Number.parseInt(ppidStr, 10),
			rssKb: Number.parseInt(rssStr, 10),
			command,
		});
	}
	return result;
}

function isOagentServeCommand(command: string): boolean {
	if (/(^|\/)oagent serve(\s|$)/.test(command)) {
		return true;
	}
	const tokens = command.split(/\s+/);
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === undefined) {
			continue;
		}
		if (token === 'oagent' || token.endsWith('/oagent')) {
			const next = tokens[i + 1];
			if (next === 'serve') {
				return true;
			}
		}
	}
	return false;
}

function isOagentBinaryCommand(command: string): boolean {
	if (/(^|\/)oagent(\s|$)/.test(command)) {
		return true;
	}
	return command.includes('/oagent ');
}

function isOtherOagentCommand(command: string): boolean {
	if (!isOagentBinaryCommand(command)) {
		return false;
	}
	return !isOagentServeCommand(command);
}

function isOpencodeCommand(command: string): boolean {
	const trimmed = command.trimStart();
	return (
		trimmed.startsWith('opencode ') ||
		trimmed === 'opencode' ||
		/(^|\/)opencode(\s|$)/.test(command)
	);
}

function buildChildrenMap(
	processes: ReadonlyArray<PsProcess>,
): Map<number, ReadonlyArray<number>> {
	const map = new Map<number, number[]>();
	for (const proc of processes) {
		const existing = map.get(proc.ppid);
		if (existing === undefined) {
			map.set(proc.ppid, [proc.pid]);
		} else {
			existing.push(proc.pid);
		}
	}
	const frozen = new Map<number, ReadonlyArray<number>>();
	for (const entry of map) {
		const ppid = entry[0];
		const children = entry[1];
		frozen.set(ppid, children);
	}
	return frozen;
}

function buildByPid(
	processes: ReadonlyArray<PsProcess>,
): Map<number, PsProcess> {
	const map = new Map<number, PsProcess>();
	for (const proc of processes) {
		map.set(proc.pid, proc);
	}
	return map;
}

function collectDescendantPids(
	rootPid: number,
	childrenMap: Map<number, ReadonlyArray<number>>,
): ReadonlyArray<number> {
	const collected: number[] = [rootPid];
	const queue: number[] = [rootPid];
	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) {
			continue;
		}
		const children = childrenMap.get(current);
		if (children === undefined) {
			continue;
		}
		for (const childPid of children) {
			collected.push(childPid);
			queue.push(childPid);
		}
	}
	return collected;
}

function isScanArtifact(command: string): boolean {
	if (/^ps -axo/.test(command)) {
		return true;
	}
	if (/^footprint -i/.test(command)) {
		return true;
	}
	return false;
}

function normalizeCommand(command: string): string {
	if (isOagentServeCommand(command)) {
		return 'oagent serve';
	}
	if (command.includes('biome') && command.includes('lsp-proxy')) {
		return 'biome lsp-proxy';
	}
	if (command.includes('typescript-language-server')) {
		return 'typescript-language-server';
	}
	if (command.includes('tsserver.js')) {
		return 'typescript tsserver';
	}
	if (command.includes('typingsInstaller.js')) {
		return 'typescript typingsInstaller';
	}
	if (command.includes('eslintServer.js')) {
		return 'vscode-eslint server';
	}
	if (/(^|\s|\/)tsgo(\s|$)/.test(command)) {
		return 'tsgo';
	}
	if (command.includes('expect-cli') && command.includes('mcp')) {
		return 'expect-cli (mcp)';
	}
	if (command.includes('cursor-agent') && command.includes(' acp')) {
		return 'cursor-agent acp';
	}
	if (isOpencodeCommand(command)) {
		return 'opencode acp';
	}
	return shortenCommand(command);
}

/** Strip node/bun launcher prefixes and absolute paths for unknown commands. */
function shortenCommand(command: string): string {
	let s = command;
	const bunMatch = s.match(/^(?:\S*\/bun)\s+(\S+\s+.*)$/);
	if (bunMatch !== null) {
		const rest = bunMatch[1];
		if (rest !== undefined) {
			s = rest;
		}
	}
	const nodeMatch = s.match(/^(?:\S*\/node)\s+(\S+\s+.*)$/);
	if (nodeMatch !== null) {
		const rest = nodeMatch[1];
		if (rest !== undefined) {
			s = rest;
		}
	}
	const parts = s.split(/\s+/);
	const shortened: string[] = [];
	for (const part of parts) {
		if (part.startsWith('/')) {
			const base = part.split('/').pop();
			if (base !== undefined && base.length > 0) {
				shortened.push(base);
			}
		} else {
			shortened.push(part);
		}
	}
	const joined = shortened.join(' ');
	if (joined.length > 80) {
		return `${joined.slice(0, 77)}…`;
	}
	return joined;
}

function parseFootprintUnit(value: number, unit: string): number {
	const u = unit.toUpperCase();
	if (u === 'B') {
		return value;
	}
	if (u === 'KB') {
		return value * 1024;
	}
	if (u === 'MB') {
		return value * 1024 * 1024;
	}
	if (u === 'GB') {
		return value * 1024 * 1024 * 1024;
	}
	throw new Error(`Unknown footprint unit: ${unit}`);
}

function parsePhysFootprintLine(line: string): number | undefined {
	const match = line.match(/phys_footprint:\s*([\d.]+)\s*([A-Za-z]+)/);
	if (match === null) {
		return undefined;
	}
	const numStr = match[1];
	const unit = match[2];
	if (numStr === undefined || unit === undefined) {
		return undefined;
	}
	return parseFootprintUnit(Number.parseFloat(numStr), unit);
}

async function readPhysFootprint(pid: number): Promise<number | undefined> {
	const proc = Bun.spawn(['footprint', '-i', String(pid)], {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const text = await new Response(proc.stdout).text();
	await proc.exited;
	if (proc.exitCode !== 0) {
		return undefined;
	}
	for (const line of text.split('\n')) {
		if (!line.includes('phys_footprint:')) {
			continue;
		}
		return parsePhysFootprintLine(line);
	}
	return undefined;
}

async function enrichProcesses(
	procs: ReadonlyArray<PsProcess>,
): Promise<ReadonlyArray<ProcessMemory>> {
	const tasks = procs.map(async (proc) => {
		const rssBytes = proc.rssKb * 1024;
		const phys = await readPhysFootprint(proc.pid);
		// footprint failed or process exited — degrade to RSS for phys display
		const physBytes = phys === undefined ? rssBytes : phys;
		return {
			pid: proc.pid,
			ppid: proc.ppid,
			command: proc.command,
			normalized: normalizeCommand(proc.command),
			rssBytes,
			physBytes,
		};
	});
	return Promise.all(tasks);
}

function groupProcesses(processes: ReadonlyArray<ProcessMemory>): {
	groups: ReadonlyArray<MemoryGroup>;
	totals: { rssBytes: number; physBytes: number };
} {
	const map = new Map<
		string,
		{ count: number; rssBytes: number; physBytes: number }
	>();
	let totalRss = 0;
	let totalPhys = 0;
	for (const proc of processes) {
		totalRss += proc.rssBytes;
		totalPhys += proc.physBytes;
		const existing = map.get(proc.normalized);
		if (existing === undefined) {
			map.set(proc.normalized, {
				count: 1,
				rssBytes: proc.rssBytes,
				physBytes: proc.physBytes,
			});
		} else {
			existing.count += 1;
			existing.rssBytes += proc.rssBytes;
			existing.physBytes += proc.physBytes;
		}
	}
	const groups: MemoryGroup[] = [];
	for (const entry of map) {
		const label = entry[0];
		const data = entry[1];
		groups.push({
			label,
			count: data.count,
			rssBytes: data.rssBytes,
			physBytes: data.physBytes,
		});
	}
	groups.sort((a, b) => b.physBytes - a.physBytes);
	return { groups, totals: { rssBytes: totalRss, physBytes: totalPhys } };
}

function findParentInSection(
	proc: ProcessMemory,
	pidSet: Set<number>,
	byPid: Map<number, PsProcess>,
): number | undefined {
	let ppid = proc.ppid;
	for (;;) {
		if (pidSet.has(ppid)) {
			return ppid;
		}
		const parent = byPid.get(ppid);
		if (parent === undefined) {
			return undefined;
		}
		ppid = parent.ppid;
	}
}

function sortPidsByPhys(
	pids: ReadonlyArray<number>,
	memByPid: Map<number, ProcessMemory>,
): ReadonlyArray<number> {
	const copy = [...pids];
	copy.sort((a, b) => {
		const ma = memByPid.get(a);
		const mb = memByPid.get(b);
		const physA = ma === undefined ? 0 : ma.physBytes;
		const physB = mb === undefined ? 0 : mb.physBytes;
		if (physB !== physA) {
			return physB - physA;
		}
		return a - b;
	});
	return copy;
}

function buildProcessTreeNode(
	pid: number,
	memByPid: Map<number, ProcessMemory>,
	childrenMap: Map<number, ReadonlyArray<number>>,
): ProcessTreeNode | undefined {
	const mem = memByPid.get(pid);
	if (mem === undefined) {
		return undefined;
	}
	const childPids = childrenMap.get(pid);
	const sortedChildPids =
		childPids === undefined ? [] : sortPidsByPhys(childPids, memByPid);
	const children: ProcessTreeNode[] = [];
	for (const childPid of sortedChildPids) {
		const childNode = buildProcessTreeNode(childPid, memByPid, childrenMap);
		if (childNode !== undefined) {
			children.push(childNode);
		}
	}
	return {
		pid: mem.pid,
		label: mem.normalized,
		command: mem.command,
		rssBytes: mem.rssBytes,
		physBytes: mem.physBytes,
		children,
	};
}

/** Build nested parent→child tree from section processes (same pid set). */
function buildProcessTree(
	rootPids: ReadonlyArray<number>,
	processes: ReadonlyArray<ProcessMemory>,
	byPid: Map<number, PsProcess>,
): ReadonlyArray<ProcessTreeNode> {
	const pidSet = new Set<number>();
	const memByPid = new Map<number, ProcessMemory>();
	const rootSet = new Set<number>();
	for (const rootPid of rootPids) {
		rootSet.add(rootPid);
	}
	for (const proc of processes) {
		pidSet.add(proc.pid);
		memByPid.set(proc.pid, proc);
	}

	const childLists = new Map<number, number[]>();
	for (const proc of processes) {
		if (rootSet.has(proc.pid)) {
			continue;
		}
		const parentPid = findParentInSection(proc, pidSet, byPid);
		if (parentPid === undefined) {
			continue;
		}
		const existing = childLists.get(parentPid);
		if (existing === undefined) {
			childLists.set(parentPid, [proc.pid]);
		} else {
			existing.push(proc.pid);
		}
	}

	const childrenMap = new Map<number, ReadonlyArray<number>>();
	for (const entry of childLists) {
		const parentPid = entry[0];
		const pids = entry[1];
		childrenMap.set(parentPid, pids);
	}

	const sortedRoots = sortPidsByPhys(rootPids, memByPid);
	const roots: ProcessTreeNode[] = [];
	for (const rootPid of sortedRoots) {
		const node = buildProcessTreeNode(rootPid, memByPid, childrenMap);
		if (node !== undefined) {
			roots.push(node);
		}
	}
	return roots;
}

function serverCoreMemory(processes: ReadonlyArray<ProcessMemory>): {
	rssBytes: number;
	physBytes: number;
} {
	let rssBytes = 0;
	let physBytes = 0;
	for (const proc of processes) {
		if (proc.normalized !== 'oagent serve') {
			continue;
		}
		rssBytes += proc.rssBytes;
		physBytes += proc.physBytes;
	}
	return { rssBytes, physBytes };
}

async function buildTreeSection(
	rootPids: ReadonlyArray<number>,
	byPid: Map<number, PsProcess>,
	childrenMap: Map<number, ReadonlyArray<number>>,
	skipPids: Set<number>,
): Promise<TreeSection> {
	const pidSet = new Set<number>();
	for (const rootPid of rootPids) {
		const descendants = collectDescendantPids(rootPid, childrenMap);
		for (const pid of descendants) {
			if (skipPids.has(pid)) {
				continue;
			}
			pidSet.add(pid);
		}
	}
	const procs: PsProcess[] = [];
	for (const pid of pidSet) {
		const proc = byPid.get(pid);
		if (proc === undefined) {
			continue;
		}
		if (isScanArtifact(proc.command)) {
			continue;
		}
		procs.push(proc);
	}
	const enriched = await enrichProcesses(procs);
	const roots: ProcessMemory[] = [];
	for (const rootPid of rootPids) {
		for (const proc of enriched) {
			if (proc.pid === rootPid) {
				roots.push(proc);
			}
		}
	}
	const grouped = groupProcesses(enriched);
	const tree = buildProcessTree(rootPids, enriched, byPid);
	return {
		roots,
		processes: enriched,
		tree,
		groups: grouped.groups,
		totals: grouped.totals,
		serverCore: serverCoreMemory(enriched),
	};
}

function formatBytes(bytes: number): string {
	const gb = 1024 * 1024 * 1024;
	const mb = 1024 * 1024;
	const kb = 1024;
	if (bytes >= gb) {
		return `${(bytes / gb).toFixed(1)} GB`;
	}
	if (bytes >= mb) {
		return `${(bytes / mb).toFixed(1)} MB`;
	}
	if (bytes >= kb) {
		return `${(bytes / kb).toFixed(1)} KB`;
	}
	return `${bytes} B`;
}

function formatTreeNodeLine(node: ProcessTreeNode): string {
	return `${node.label} (pid ${node.pid}) — ${formatBytes(node.rssBytes)} RSS · ${formatBytes(node.physBytes)} phys`;
}

function renderTreeChildren(
	children: ReadonlyArray<ProcessTreeNode>,
	prefix: string,
): ReadonlyArray<string> {
	const lines: string[] = [];
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child === undefined) {
			continue;
		}
		const isLast = i === children.length - 1;
		const branch = isLast ? '└─ ' : '├─ ';
		const nextPrefix = prefix + (isLast ? '   ' : '│  ');
		lines.push(`${prefix}${branch}${formatTreeNodeLine(child)}`);
		const sublines = renderTreeChildren(child.children, nextPrefix);
		for (const subline of sublines) {
			lines.push(subline);
		}
	}
	return lines;
}

function renderProcessHierarchy(tree: ReadonlyArray<ProcessTreeNode>): string {
	const lines: string[] = [];
	lines.push('### Process hierarchy');
	lines.push('');
	for (let i = 0; i < tree.length; i++) {
		const root = tree[i];
		if (root === undefined) {
			continue;
		}
		lines.push(formatTreeNodeLine(root));
		const childLines = renderTreeChildren(root.children, '');
		for (const childLine of childLines) {
			lines.push(childLine);
		}
		if (i < tree.length - 1) {
			lines.push('');
		}
	}
	return lines.join('\n');
}

function renderGroupTable(groups: ReadonlyArray<MemoryGroup>): string {
	const lines: string[] = [];
	lines.push('| Group | Count | RSS | phys |');
	lines.push('| --- | ---: | ---: | ---: |');
	for (const group of groups) {
		lines.push(
			`| ${group.label} | ${group.count} | ${formatBytes(group.rssBytes)} | ${formatBytes(group.physBytes)} |`,
		);
	}
	return lines.join('\n');
}

function renderTreeSection(title: string, section: TreeSection): string {
	const lines: string[] = [];
	lines.push(`## ${title}`);
	lines.push('');
	lines.push(renderGroupTable(section.groups));
	lines.push('');
	lines.push(renderProcessHierarchy(section.tree));
	lines.push('');
	lines.push(
		`**Total:** ${formatBytes(section.totals.rssBytes)} RSS · ${formatBytes(section.totals.physBytes)} phys`,
	);
	return lines.join('\n');
}

function renderMarkdown(report: MemReport): string {
	const lines: string[] = [];

	if (report.serverTree !== undefined) {
		const tree = report.serverTree;
		lines.push(
			`**oagent server core:** ${formatBytes(tree.serverCore.rssBytes)} RSS · ${formatBytes(tree.serverCore.physBytes)} phys · **full tree:** ${formatBytes(tree.totals.rssBytes)} RSS / ${formatBytes(tree.totals.physBytes)} phys (incl. compressed)`,
		);
		lines.push('');
		lines.push(
			'The oagent server process itself is small; most memory is the `opencode` ACP subprocess and the language servers / MCP servers it spawns. Activity Monitor and iStat Menus report **phys_footprint** (resident + compressed pages), which is larger than RSS under memory pressure.',
		);
		lines.push('');
		lines.push(renderTreeSection('Server process tree', tree));
	} else {
		lines.push('No running `oagent serve` process found.');
	}

	if (report.otherOagent !== undefined) {
		lines.push('');
		lines.push(renderTreeSection('Other oagent processes', report.otherOagent));
	}

	if (report.orphanedOpencode !== undefined) {
		lines.push('');
		lines.push(
			renderTreeSection(
				'Possibly-orphaned opencode (no live oagent parent)',
				report.orphanedOpencode,
			),
		);
	}

	lines.push('');
	return `${lines.join('\n')}\n`;
}

function collectOtherOagentRoots(
	processes: ReadonlyArray<PsProcess>,
	excludedPids: Set<number>,
	skipPids: Set<number>,
): ReadonlyArray<number> {
	const roots: number[] = [];
	for (const proc of processes) {
		if (excludedPids.has(proc.pid)) {
			continue;
		}
		if (skipPids.has(proc.pid)) {
			continue;
		}
		if (!isOtherOagentCommand(proc.command)) {
			continue;
		}
		roots.push(proc.pid);
		excludedPids.add(proc.pid);
	}
	return roots;
}

function collectOrphanedOpencode(
	processes: ReadonlyArray<PsProcess>,
	excludedPids: Set<number>,
): ReadonlyArray<PsProcess> {
	const orphans: PsProcess[] = [];
	for (const proc of processes) {
		if (excludedPids.has(proc.pid)) {
			continue;
		}
		if (proc.ppid !== 1) {
			continue;
		}
		const trimmed = proc.command.trimStart();
		if (!trimmed.startsWith('opencode')) {
			continue;
		}
		orphans.push(proc);
	}
	return orphans;
}

function selfSkipPids(
	childrenMap: Map<number, ReadonlyArray<number>>,
): Set<number> {
	const selfPid = process.pid;
	return new Set(collectDescendantPids(selfPid, childrenMap));
}

async function buildMemReport(): Promise<MemReport> {
	const proc = Bun.spawn(['ps', '-axo', 'pid=,ppid=,rss=,command='], {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const raw = await new Response(proc.stdout).text();
	await proc.exited;
	if (proc.exitCode !== 0) {
		const errText = await new Response(proc.stderr).text();
		throw new Error(`ps failed: ${errText.trim()}`);
	}

	const processes = parsePsOutput(raw);
	const byPid = buildByPid(processes);
	const childrenMap = buildChildrenMap(processes);
	const skipPids = selfSkipPids(childrenMap);

	const serverRoots: number[] = [];
	for (const p of processes) {
		if (isOagentServeCommand(p.command)) {
			serverRoots.push(p.pid);
		}
	}

	const serverTreePids = new Set<number>();
	for (const rootPid of serverRoots) {
		const descendants = collectDescendantPids(rootPid, childrenMap);
		for (const pid of descendants) {
			if (skipPids.has(pid)) {
				continue;
			}
			serverTreePids.add(pid);
		}
	}

	const serverTree =
		serverRoots.length > 0
			? await buildTreeSection(serverRoots, byPid, childrenMap, skipPids)
			: undefined;

	const otherRoots = collectOtherOagentRoots(
		processes,
		serverTreePids,
		skipPids,
	);
	const otherOagent =
		otherRoots.length > 0
			? await buildTreeSection(otherRoots, byPid, childrenMap, skipPids)
			: undefined;

	const orphanProcs = collectOrphanedOpencode(processes, serverTreePids);
	const filteredOrphans: PsProcess[] = [];
	for (const proc of orphanProcs) {
		if (skipPids.has(proc.pid)) {
			continue;
		}
		filteredOrphans.push(proc);
	}
	const orphanedOpencode =
		filteredOrphans.length > 0
			? await (async () => {
					const enriched = await enrichProcesses(filteredOrphans);
					const grouped = groupProcesses(enriched);
					const orphanRootPids: number[] = [];
					for (const proc of enriched) {
						orphanRootPids.push(proc.pid);
					}
					const tree = buildProcessTree(orphanRootPids, enriched, byPid);
					return {
						roots: enriched,
						processes: enriched,
						tree,
						groups: grouped.groups,
						totals: grouped.totals,
						serverCore: { rssBytes: 0, physBytes: 0 },
					};
				})()
			: undefined;

	return {
		serverTree,
		otherOagent,
		orphanedOpencode,
	};
}

function runMem(params: { json: boolean }) {
	return Effect.tryPromise(async () => {
		if (process.platform !== 'darwin') {
			process.stderr.write(
				'oagent doctor mem requires macOS (uses the footprint(1) tool).\n',
			);
			process.exitCode = 1;
			return;
		}

		const report = await buildMemReport();

		if (params.json) {
			process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
			return;
		}

		process.stdout.write(renderMarkdown(report));
	}).pipe(
		Effect.catchAll((cause) =>
			Effect.sync(() => {
				const message = errorMessage(cause);
				process.stderr.write(
					`${JSON.stringify({ status: 'error', message })}\n`,
				);
				process.exitCode = 1;
			}),
		),
	);
}

export const doctorCmd = (_version: Version) => {
	const mem = Command.make(
		'mem',
		{
			json: Options.boolean('json').pipe(
				Options.withDefault(false),
				Options.withDescription(
					'Emit full structured report as JSON instead of human-readable markdown.',
				),
			),
		},
		(opts) => runMem({ json: opts.json }),
	).pipe(
		Command.withDescription(
			'Break down memory usage for oagent serve and its opencode/LSP/MCP subprocess tree (macOS only).',
		),
	);

	return Command.make('doctor').pipe(
		Command.withDescription('Diagnostics for local oagent installations'),
		Command.withSubcommands([mem]),
	);
};
