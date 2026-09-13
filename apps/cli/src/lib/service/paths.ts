import os from 'node:os';
import { getOagentHomeDir } from '@oagent/engine';
import { Effect } from 'effect';
import type { ConfigError } from 'effect/Config';
import { FileSystem } from 'effect/FileSystem';
import { Path } from 'effect/Path';
import { ServiceError } from '#/lib/service/errors.ts';
import {
	errorMessage,
	SERVICE_LABEL,
	type ServicePaths,
} from '#/lib/service/launchctl.ts';

export function getServicePaths(): Effect.Effect<
	ServicePaths,
	ConfigError,
	Path
> {
	return Effect.gen(function* () {
		const path = yield* Path;
		const homeDir = yield* getOagentHomeDir;
		const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
		return {
			plistPath: path.join(launchAgentsDir, `${SERVICE_LABEL}.plist`),
			pidPath: path.join(homeDir, 'service.pid'),
			launchAgentsDir,
		};
	});
}

export function ensureServiceDirectories(
	paths: ServicePaths,
): Effect.Effect<void, ServiceError, FileSystem | Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		yield* fs
			.makeDirectory(path.dirname(paths.pidPath), { recursive: true })
			.pipe(
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
