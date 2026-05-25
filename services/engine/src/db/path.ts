import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveDbPath(): string {
	const dir = path.join(os.homedir(), '.config', 'oagent');
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, 'sqlite.db');
}
