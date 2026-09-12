import os from 'node:os';
import {
	ensureOagentLogsDir,
	getOagentBaseDir,
	getOagentLogsDir,
} from '@oagent/engine';
import { Effect } from 'effect';
import { FileSystem } from 'effect/FileSystem';
import { Path } from 'effect/Path';
import { ServiceError } from '#/lib/service/errors.ts';
import {
	errorMessage,
	SERVICE_LABEL,
	type ServicePaths,
} from '#/lib/service/launchctl.ts';

export function getServicePaths(): Effect.Effect<ServicePaths, never, Path> {
	return Effect.gen(function* () {
		const path = yield* Path;
		const baseDir = yield* getOagentBaseDir;
		const logsDir = yield* getOagentLogsDir;
		const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
		return {
			plistPath: path.join(launchAgentsDir, `${SERVICE_LABEL}.plist`),
			pidPath: path.join(baseDir, 'service.pid'),
			jsonlLogPath: path.join(logsDir, 'oagent.jsonl'),
			stdoutLogPath: path.join(logsDir, 'oagent.out.log'),
			stderrLogPath: path.join(logsDir, 'oagent.err.log'),
			launchAgentsDir,
		};
	});
}

export function ensureServiceDirectories(
	paths: ServicePaths,
): Effect.Effect<void, ServiceError, FileSystem | Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		yield* ensureOagentLogsDir.pipe(
			Effect.catch((cause) =>
				Effect.fail(
					new ServiceError({
						message: `Failed to prepare service directories: ${errorMessage(cause)}`,
					}),
				),
			),
		);
		yield* fs.makeDirectory(paths.launchAgentsDir, { recursive: true }).pipe(
			Effect.catch((cause) =>
				Effect.fail(
					new ServiceError({
						message: `Failed to prepare service directories: ${errorMessage(cause)}`,
					}),
				),
			),
		);
	});
}
