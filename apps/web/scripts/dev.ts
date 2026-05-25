import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { resolve } from 'node:path';

const DEV_JSON = resolve(
	import.meta.dirname,
	'../../../services/engine/.data/dev.json',
);

const POLL_INTERVAL_MS = 250;
const TIMEOUT_MS = 30_000;

async function waitForDevJson(): Promise<string> {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const raw = await fs.readFile(DEV_JSON, 'utf-8');
			const parsed = JSON.parse(raw) as { url: string };
			return parsed.url.replace(/\/mcp$/, '');
		} catch {
			await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
		}
	}
	console.error(
		'[web] Timed out waiting for services/engine/.data/dev.json after 30s.\n' +
			"      Start the engine first: bun --filter '@oagent/engine' dev",
	);
	process.exit(1);
}

const engineUrl = await waitForDevJson();

const child = spawn('bunx', ['vite'], {
	env: { ...process.env, ENGINE_URL: engineUrl },
	stdio: ['inherit', 'inherit', 'inherit'],
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
	process.on(sig, () => child.kill(sig));
}

child.on('exit', (code) => process.exit(code ?? 0));
