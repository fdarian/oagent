import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getOagentBaseDir(): string {
	return path.join(os.homedir(), '.config', 'oagent');
}

export function getOagentLogsDir(): string {
	return path.join(getOagentBaseDir(), 'logs');
}

export function ensureOagentLogsDir(): string {
	const logsDir = getOagentLogsDir();
	fs.mkdirSync(logsDir, { recursive: true });
	return logsDir;
}
