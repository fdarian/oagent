import fs from 'node:fs';
import { getOagentBaseDir } from '@oagent/engine';
import { Effect } from 'effect';
import type { Path } from 'effect/Path';
import {
	ensureMacOs,
	getCallerPath,
	getServiceBinaryPath,
	validatePort,
} from '#/lib/service/environment.ts';
import { ServiceError } from '#/lib/service/errors.ts';
import {
	getLaunchctlDomain,
	isNotLoaded,
	runLaunchctl,
	SERVICE_LABEL,
	type ServicePaths,
} from '#/lib/service/launchctl.ts';
import {
	ensureServiceDirectories,
	getServicePaths,
} from '#/lib/service/paths.ts';
import {
	createPlistXml,
	loadServiceConfiguration,
	writePlistFile,
} from '#/lib/service/plist.ts';
import { loadManagedServerStatus } from '#/lib/service/process.ts';

export type ServiceStatus =
	| {
			installed: false;
			loaded: false;
			pid: number | undefined;
			binaryPath: undefined;
			runAtLoad: false;
			port: undefined;
			paths: ServicePaths;
	  }
	| {
			installed: true;
			loaded: boolean;
			pid: number | undefined;
			binaryPath: string;
			runAtLoad: boolean;
			port: number;
			paths: ServicePaths;
	  };

export type InstallResult = {
	binaryPath: string;
	port: number;
	paths: ServicePaths;
};

export function loadServiceStatus(): Effect.Effect<
	ServiceStatus,
	ServiceError,
	Path
> {
	return Effect.gen(function* () {
		yield* ensureMacOs();

		const paths = yield* getServicePaths();
		const domain = yield* getLaunchctlDomain();
		const installed = fs.existsSync(paths.plistPath);
		const managedServer = yield* loadManagedServerStatus(paths.pidPath);

		if (!installed) {
			return {
				installed: false,
				loaded: false,
				pid: managedServer.pid,
				binaryPath: undefined,
				runAtLoad: false,
				port: undefined,
				paths,
			};
		}

		const configuration = yield* loadServiceConfiguration(paths.plistPath);

		const printResult = yield* runLaunchctl([
			'print',
			`${domain}/${SERVICE_LABEL}`,
		]);

		if (isNotLoaded(printResult)) {
			return {
				installed: true,
				loaded: false,
				pid: managedServer.pid,
				binaryPath: configuration.binaryPath,
				runAtLoad: configuration.runAtLoad,
				port: configuration.port,
				paths,
			};
		}

		if (printResult.exitCode !== 0) {
			return yield* Effect.fail(
				new ServiceError({
					message: `launchctl print failed: ${printResult.stderr.trim() || printResult.stdout.trim()}`,
				}),
			);
		}

		return {
			installed: true,
			loaded: true,
			pid: managedServer.pid,
			binaryPath: configuration.binaryPath,
			runAtLoad: configuration.runAtLoad,
			port: configuration.port,
			paths,
		};
	});
}

/** Writes a fresh plist and bootstraps the service. Does NOT bootout first. */
export function installAndBootstrap(port: number) {
	return Effect.gen(function* () {
		const validatedPort = yield* validatePort(port);
		const binaryPath = yield* getServiceBinaryPath();
		const pathEnv = yield* getCallerPath();
		const paths = yield* getServicePaths();
		const workingDirectory = yield* getOagentBaseDir;

		yield* ensureServiceDirectories(paths);

		const plistXml = createPlistXml({
			binaryPath,
			port: validatedPort,
			pathEnv,
			workingDirectory,
		});
		yield* writePlistFile(paths.plistPath, plistXml);

		const domain = yield* getLaunchctlDomain();
		const bootstrapResult = yield* runLaunchctl([
			'bootstrap',
			domain,
			paths.plistPath,
		]);
		if (bootstrapResult.exitCode !== 0) {
			return yield* Effect.fail(
				new ServiceError({
					message: `launchctl bootstrap failed: ${bootstrapResult.stderr.trim() || bootstrapResult.stdout.trim()}`,
				}),
			);
		}

		return { binaryPath, port: validatedPort, paths };
	});
}
