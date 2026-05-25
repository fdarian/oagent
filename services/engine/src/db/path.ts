import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveDbPath(): string {
	if (process.env.OAGENT_DB_PATH) {
		const resolved = path.resolve(process.env.OAGENT_DB_PATH);
		fs.mkdirSync(path.dirname(resolved), { recursive: true });
		return resolved;
	}

	const dir = path.join(os.homedir(), '.config', 'oagent');
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, 'sqlite.db');
}
