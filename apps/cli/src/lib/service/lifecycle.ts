import fs from 'node:fs';
import type { Path } from '@effect/platform/Path';
import { getOagentBaseDir } from '@oagent/engine';
import { Effect } from 'effect';
import {
	ensureMacOs,
	getCallerPath,
	getServiceBinaryPath,
	validatePort,
} from '#/lib/service/environment.ts';
import {
	getLaunchctlDomain,
	isNotLoaded,
	parseServicePid,
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
	loadConfiguredPort,
	writePlistFile,
} from '#/lib/service/plist.ts';

export type ServiceStatus =
	| {
			installed: false;
			loaded: false;
			pid: undefined;
			paths: ServicePaths;
	  }
	| {
			installed: true;
			loaded: boolean;
			pid: number | undefined;
			port: number;
			paths: ServicePaths;
	  };

export type InstallResult = {
	port: number;
	paths: ServicePaths;
};

export function loadServiceStatus(): Effect.Effect<ServiceStatus, Error, Path> {
	return Effect.gen(function* () {
		yield* ensureMacOs();

		const paths = yield* getServicePaths();
		const domain = yield* getLaunchctlDomain();
		const installed = fs.existsSync(paths.plistPath);

		if (!installed) {
			return {
				installed: false,
				loaded: false,
				pid: undefined,
				paths,
			};
		}

		const port = yield* loadConfiguredPort(paths.plistPath);

		const printResult = yield* runLaunchctl([
			'print',
			`${domain}/${SERVICE_LABEL}`,
		]);

		if (isNotLoaded(printResult)) {
			return {
				installed: true,
				loaded: false,
				pid: undefined,
				port,
				paths,
			};
		}

		if (printResult.exitCode !== 0) {
			return yield* Effect.fail(
				new Error(
					`launchctl print failed: ${printResult.stderr.trim() || printResult.stdout.trim()}`,
				),
			);
		}

		return {
			installed: true,
			loaded: true,
			pid: parseServicePid(printResult.stdout),
			port,
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
			jsonlLogPath: paths.jsonlLogPath,
			stdoutLogPath: paths.stdoutLogPath,
			stderrLogPath: paths.stderrLogPath,
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
				new Error(
					`launchctl bootstrap failed: ${bootstrapResult.stderr.trim() || bootstrapResult.stdout.trim()}`,
				),
			);
		}

		return { port: validatedPort, paths };
	});
}
