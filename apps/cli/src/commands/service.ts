import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command, Options } from '@effect/cli';
import { ensureOagentLogsDir, getOagentLogsDir } from '@oagent/engine';
import { Effect } from 'effect';
import type { Version } from '#/lib/misc.ts';

const SERVICE_LABEL = 'com.oagent.service';

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type ServicePaths = {
	plistPath: string;
	jsonlLogPath: string;
	stdoutLogPath: string;
	stderrLogPath: string;
	launchAgentsDir: string;
};

type ServiceStatus =
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

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function ensureMacOs(): Effect.Effect<void, Error> {
	if (process.platform !== 'darwin') {
		return Effect.fail(
			new Error(
				`oagent service is only supported on macOS (launchd); your platform is ${process.platform}`,
			),
		);
	}
	return Effect.void;
}

function getLaunchctlDomain(): Effect.Effect<string, Error> {
	const getuid = process.getuid;
	if (getuid === undefined) {
		return Effect.fail(
			new Error('Unable to determine current user ID for launchctl'),
		);
	}
	const uid = getuid.call(process);
	return Effect.succeed(`gui/${uid}`);
}

function getServiceBinaryPath(): Effect.Effect<string, Error> {
	const binaryPath = process.execPath;
	if (path.basename(binaryPath) === 'bun') {
		return Effect.fail(
			new Error(
				'`oagent service` must be run from the built `oagent` binary, not via `bun`; run `bun run build` and invoke `apps/cli/dist/oagent`.',
			),
		);
	}
	return Effect.succeed(binaryPath);
}

function getCallerPath(): Effect.Effect<string, Error> {
	const pathEnv = process.env.PATH;
	if (pathEnv === undefined || pathEnv.length === 0) {
		return Effect.fail(
			new Error(
				'Unable to read PATH from the environment to install the service',
			),
		);
	}
	return Effect.succeed(pathEnv);
}

function getServicePaths(): ServicePaths {
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

function ensureServiceDirectories(
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

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function createPlistXml(params: {
	binaryPath: string;
	port: number;
	jsonlLogPath: string;
	stdoutLogPath: string;
	stderrLogPath: string;
	pathEnv: string;
}): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		'<dict>',
		'\t<key>Label</key>',
		`\t<string>${escapeXml(SERVICE_LABEL)}</string>`,
		'\t<key>ProgramArguments</key>',
		'\t<array>',
		`\t\t<string>${escapeXml(params.binaryPath)}</string>`,
		'\t\t<string>serve</string>',
		'\t\t<string>--port</string>',
		`\t\t<string>${String(params.port)}</string>`,
		'\t\t<string>--log-file</string>',
		`\t\t<string>${escapeXml(params.jsonlLogPath)}</string>`,
		'\t</array>',
		'\t<key>RunAtLoad</key>',
		'\t<true/>',
		'\t<key>KeepAlive</key>',
		'\t<true/>',
		'\t<key>StandardOutPath</key>',
		`\t<string>${escapeXml(params.stdoutLogPath)}</string>`,
		'\t<key>StandardErrorPath</key>',
		`\t<string>${escapeXml(params.stderrLogPath)}</string>`,
		'\t<key>WorkingDirectory</key>',
		`\t<string>${escapeXml(os.homedir())}</string>`,
		// launchd starts agents with a minimal PATH; bake in the caller's PATH so
		// the engine can spawn its ACP backends (opencode, codex-acp, …).
		'\t<key>EnvironmentVariables</key>',
		'\t<dict>',
		'\t\t<key>PATH</key>',
		`\t\t<string>${escapeXml(params.pathEnv)}</string>`,
		'\t</dict>',
		'</dict>',
		'</plist>',
		'',
	].join('\n');
}

async function runCommand(
	command: string,
	args: ReadonlyArray<string>,
): Promise<CommandResult> {
	const proc = Bun.spawn([command, ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	await proc.exited;
	if (proc.exitCode === null) {
		throw new Error(`${command} exited without an exit code`);
	}
	return {
		exitCode: proc.exitCode,
		stdout,
		stderr,
	};
}

function runLaunchctl(
	args: ReadonlyArray<string>,
): Effect.Effect<CommandResult, Error> {
	return Effect.tryPromise({
		try: () => runCommand('launchctl', args),
		catch: (cause) =>
			new Error(`launchctl ${args.join(' ')} failed: ${errorMessage(cause)}`),
	});
}

function loadConfiguredPort(plistPath: string): Effect.Effect<number, Error> {
	return Effect.try({
		try: () => {
			const plist = fs.readFileSync(plistPath, 'utf8');
			const match = plist.match(
				/<string>--port<\/string>\s*<string>(\d+)<\/string>/,
			);
			if (match === null) {
				throw new Error(`Unable to parse configured port from ${plistPath}`);
			}
			const portValue = match[1];
			if (portValue === undefined) {
				throw new Error(`Unable to parse configured port from ${plistPath}`);
			}
			return Number.parseInt(portValue, 10);
		},
		catch: (cause) =>
			cause instanceof Error
				? cause
				: new Error(
						`Unable to parse configured port from ${plistPath}: ${errorMessage(cause)}`,
					),
	});
}

function parseServicePid(output: string): number | undefined {
	const match = output.match(/\bpid = (\d+)\b/);
	if (match === null) {
		return undefined;
	}
	const pidValue = match[1];
	if (pidValue === undefined) {
		return undefined;
	}
	return Number.parseInt(pidValue, 10);
}

function isNotLoaded(result: CommandResult): boolean {
	if (result.exitCode === 0) {
		return false;
	}
	const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
	return (
		combined.includes('could not find service') ||
		combined.includes('could not find specified service') ||
		combined.includes('service could not be found') ||
		combined.includes('domain does not support specified action') ||
		// launchctl phrases "not currently loaded" as errno 3 (ESRCH) on bootout
		combined.includes('no such process')
	);
}

function writeLines(lines: ReadonlyArray<string>): void {
	process.stdout.write(`${lines.join('\n')}\n`);
}

function validatePort(port: number): Effect.Effect<number, Error> {
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		return Effect.fail(
			new Error(`Invalid port ${port}; expected an integer in 1..65535`),
		);
	}
	return Effect.succeed(port);
}

function writePlistFile(
	plistPath: string,
	plistXml: string,
): Effect.Effect<void, Error> {
	return Effect.try({
		try: () => {
			fs.writeFileSync(plistPath, plistXml, 'utf8');
		},
		catch: (cause) =>
			new Error(`Failed to write LaunchAgent plist: ${errorMessage(cause)}`),
	});
}

function loadServiceStatus(): Effect.Effect<ServiceStatus, Error> {
	return Effect.gen(function* () {
		yield* ensureMacOs();

		const paths = getServicePaths();
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

function bootoutService(_paths: ServicePaths): Effect.Effect<boolean, Error> {
	return Effect.gen(function* () {
		const domain = yield* getLaunchctlDomain();
		const result = yield* runLaunchctl([
			'bootout',
			`${domain}/${SERVICE_LABEL}`,
		]);
		if (result.exitCode === 0) {
			return true;
		}
		if (isNotLoaded(result)) {
			return false;
		}
		return yield* Effect.fail(
			new Error(
				`launchctl bootout failed: ${result.stderr.trim() || result.stdout.trim()}`,
			),
		);
	});
}

function runStart(port: number): Effect.Effect<void, Error> {
	return Effect.gen(function* () {
		yield* ensureMacOs();
		const validatedPort = yield* validatePort(port);
		const binaryPath = yield* getServiceBinaryPath();
		const pathEnv = yield* getCallerPath();
		const paths = getServicePaths();

		yield* ensureServiceDirectories(paths);
		yield* bootoutService(paths);

		const plistXml = createPlistXml({
			binaryPath,
			port: validatedPort,
			jsonlLogPath: paths.jsonlLogPath,
			stdoutLogPath: paths.stdoutLogPath,
			stderrLogPath: paths.stderrLogPath,
			pathEnv,
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

		writeLines([
			'service started',
			`label: ${SERVICE_LABEL}`,
			`port: ${validatedPort}`,
			`plist: ${paths.plistPath}`,
			`jsonl log: ${paths.jsonlLogPath}`,
		]);
	});
}

function runStop(): Effect.Effect<void, Error> {
	return Effect.gen(function* () {
		yield* ensureMacOs();
		const paths = getServicePaths();
		if (!fs.existsSync(paths.plistPath)) {
			process.stdout.write('not installed (run `oagent service start`)\n');
			return;
		}
		const stopped = yield* bootoutService(paths);

		if (!stopped) {
			writeLines([
				'service not running',
				`label: ${SERVICE_LABEL}`,
				`plist: ${paths.plistPath}`,
			]);
			return;
		}

		writeLines([
			'service stopped',
			`label: ${SERVICE_LABEL}`,
			`plist: ${paths.plistPath}`,
		]);
	});
}

function runStatus(): Effect.Effect<void, Error> {
	return Effect.gen(function* () {
		const status = yield* loadServiceStatus();

		if (!status.installed) {
			process.stdout.write('not installed (run `oagent service start`)\n');
			return;
		}

		const runningLine =
			status.loaded && status.pid !== undefined
				? `running: yes (pid ${status.pid})`
				: 'running: no';

		writeLines([
			`service: ${SERVICE_LABEL}`,
			'installed: yes',
			`loaded: ${status.loaded ? 'yes' : 'no'}`,
			runningLine,
			`port: ${status.port}`,
			`plist: ${status.paths.plistPath}`,
			`jsonl log: ${status.paths.jsonlLogPath}`,
		]);
	});
}

export const serviceCmd = (_version: Version) => {
	const start = Command.make(
		'start',
		{
			port: Options.integer('port').pipe(
				Options.withDefault(17_777),
				Options.withDescription('Port to run the background service on'),
			),
		},
		(params) => runStart(params.port),
	).pipe(
		Command.withDescription('Install and start the launchd background service'),
	);

	const status = Command.make('status', {}, () => runStatus()).pipe(
		Command.withDescription('Show launchd service status'),
	);

	const stop = Command.make('stop', {}, () => runStop()).pipe(
		Command.withDescription('Stop the launchd background service'),
	);

	return Command.make('service').pipe(
		Command.withDescription('Manage the macOS launchd background service'),
		Command.withSubcommands([start, status, stop]),
	);
};
