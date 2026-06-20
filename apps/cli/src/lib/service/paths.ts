import os from 'node:os';
import { FileSystem } from '@effect/platform/FileSystem';
import { Path } from '@effect/platform/Path';
import { ensureOagentLogsDir, getOagentLogsDir } from '@oagent/engine';
import { Effect } from 'effect';
import {
	errorMessage,
	SERVICE_LABEL,
	type ServicePaths,
} from '#/lib/service/launchctl.ts';

export function getServicePaths(): Effect.Effect<ServicePaths, never, Path> {
	return Effect.gen(function* () {
		const path = yield* Path;
		const logsDir = yield* getOagentLogsDir;
		const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
		return {
			plistPath: path.join(launchAgentsDir, `${SERVICE_LABEL}.plist`),
			jsonlLogPath: path.join(logsDir, 'oagent.jsonl'),
			stdoutLogPath: path.join(logsDir, 'oagent.out.log'),
			stderrLogPath: path.join(logsDir, 'oagent.err.log'),
			launchAgentsDir,
		};
	});
}

export function ensureServiceDirectories(
	paths: ServicePaths,
): Effect.Effect<void, Error, FileSystem | Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		yield* ensureOagentLogsDir.pipe(
			Effect.catchAll((cause) =>
				Effect.fail(
					new Error(
						`Failed to prepare service directories: ${errorMessage(cause)}`,
					),
				),
			),
		);
		yield* fs
			.makeDirectory(paths.launchAgentsDir, { recursive: true })
			.pipe(
				Effect.catchAll((cause) =>
					Effect.fail(
						new Error(
							`Failed to prepare service directories: ${errorMessage(cause)}`,
						),
					),
				),
			);
	});
}
