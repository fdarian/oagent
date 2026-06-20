import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureOagentLogsDir, getOagentLogsDir } from '@oagent/engine';
import { Effect } from 'effect';
import {
	errorMessage,
	SERVICE_LABEL,
	type ServicePaths,
} from '#/lib/service/launchctl.ts';

export function getServicePaths(): ServicePaths {
	const logsDir = getOagentLogsDir();
	const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
	return {
		plistPath: path.join(launchAgentsDir, `${SERVICE_LABEL}.plist`),
		jsonlLogPath: path.join(logsDir, 'oagent.jsonl'),
		stdoutLogPath: path.join(logsDir, 'oagent.out.log'),
		stderrLogPath: path.join(logsDir, 'oagent.err.log'),
		launchAgentsDir,
	};
}

export function ensureServiceDirectories(
	paths: ServicePaths,
): Effect.Effect<void, Error> {
	return Effect.try({
		try: () => {
			ensureOagentLogsDir();
			fs.mkdirSync(paths.launchAgentsDir, { recursive: true });
		},
		catch: (cause) =>
			new Error(
				`Failed to prepare service directories: ${errorMessage(cause)}`,
			),
	});
}
