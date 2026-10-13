import fs from 'node:fs';
import { getOagentHomeDir } from '@oagent/engine';
import { Effect } from 'effect';
import type { ConfigError } from 'effect/Config';
import type { Path } from 'effect/Path';
import { isIdleExitActive, requireServeArgv } from '#/lib/service/daemon.ts';
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
import type { ServeArgv } from '#/lib/service/serve-argv.ts';

export type DaemonMode = 'service' | 'on-demand' | 'not-responding';

export type ServiceStatus =
	| {
			installed: false;
			loaded: false;
			pid: number | undefined;
			binaryPath: undefined;
			runningBinaryPath: string | undefined;
			runningPort: number | undefined;
			mode: DaemonMode | undefined;
			runAtLoad: false;
			port: undefined;
			paths: ServicePaths;
	  }
	| {
			installed: true;
			loaded: boolean;
			pid: number | undefined;
			binaryPath: string;
			runningBinaryPath: string | undefined;
			runningPort: number | undefined;
			mode: DaemonMode | undefined;
			runAtLoad: boolean;
			port: number;
			paths: ServicePaths;
	  };

export type InstallResult = {
	binaryPath: string;
	port: number;
	paths: ServicePaths;
};

function loadDaemonMode(argv: ServeArgv): Effect.Effect<DaemonMode, never> {
	if (!argv.idleExit) {
		return Effect.succeed('service');
	}
	return isIdleExitActive(argv).pipe(
		Effect.map((active): DaemonMode => (active ? 'on-demand' : 'service')),
		Effect.catchTag('ServiceError', () =>
			Effect.succeed<DaemonMode>('not-responding'),
		),
	);
}

export function loadServiceStatus(): Effect.Effect<
	ServiceStatus,
	ServiceError | ConfigError,
	Path
> {
	return Effect.gen(function* () {
		yield* ensureMacOs();

		const paths = yield* getServicePaths();
		const domain = yield* getLaunchctlDomain();
		const installed = fs.existsSync(paths.plistPath);
		const daemon = yield* loadManagedServerStatus(paths.pidPath);
		const argv = daemon.running ? yield* requireServeArgv(daemon) : undefined;
		const runningBinaryPath = argv?.binary.join(' ');
		const mode = argv === undefined ? undefined : yield* loadDaemonMode(argv);

		if (!installed) {
			return {
				installed: false,
				loaded: false,
				pid: daemon.pid,
				binaryPath: undefined,
				runningBinaryPath,
				runningPort: argv?.port,
				mode,
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
				pid: daemon.pid,
				binaryPath: configuration.binaryPath,
				runningBinaryPath,
				runningPort: argv?.port,
				mode,
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
			pid: daemon.pid,
			binaryPath: configuration.binaryPath,
			runningBinaryPath,
			runningPort: argv?.port,
			mode,
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
		const homeDirectory = yield* getOagentHomeDir;

		yield* ensureServiceDirectories(paths);

		const plistXml = createPlistXml({
			binaryPath,
			port: validatedPort,
			pathEnv,
			homeDirectory,
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
