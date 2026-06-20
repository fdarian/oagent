import { Effect } from 'effect';
import { ServiceError } from '#/lib/service/errors.ts';

export const SERVICE_LABEL = 'com.oagent.service';

export type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type ServicePaths = {
	plistPath: string;
	jsonlLogPath: string;
	stdoutLogPath: string;
	stderrLogPath: string;
	launchAgentsDir: string;
};

export function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
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
		throw new ServiceError({
			message: `${command} exited without an exit code`,
		});
	}
	return {
		exitCode: proc.exitCode,
		stdout,
		stderr,
	};
}

export function runLaunchctl(
	args: ReadonlyArray<string>,
): Effect.Effect<CommandResult, ServiceError> {
	return Effect.tryPromise({
		try: () => runCommand('launchctl', args),
		catch: (cause) =>
			new ServiceError({
				message: `launchctl ${args.join(' ')} failed: ${errorMessage(cause)}`,
			}),
	});
}

export function getLaunchctlDomain(): Effect.Effect<string, ServiceError> {
	const getuid = process.getuid;
	if (getuid === undefined) {
		return Effect.fail(
			new ServiceError({
				message: 'Unable to determine current user ID for launchctl',
			}),
		);
	}
	const uid = getuid.call(process);
	return Effect.succeed(`gui/${uid}`);
}

export function isNotLoaded(result: CommandResult): boolean {
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

export function parseServicePid(output: string): number | undefined {
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

export function bootoutService(
	_paths: ServicePaths,
): Effect.Effect<boolean, ServiceError> {
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
			new ServiceError({
				message: `launchctl bootout failed: ${result.stderr.trim() || result.stdout.trim()}`,
			}),
		);
	});
}

/** Returns true when the service is currently loaded in launchd (exit 0 = loaded). */
export function isServiceLoaded(): Effect.Effect<boolean, ServiceError> {
	return Effect.gen(function* () {
		const domain = yield* getLaunchctlDomain();
		const result = yield* runLaunchctl(['print', `${domain}/${SERVICE_LABEL}`]);
		if (result.exitCode === 0) {
			return true;
		}
		if (isNotLoaded(result)) {
			return false;
		}
		return yield* Effect.fail(
			new ServiceError({
				message: `launchctl print failed: ${result.stderr.trim() || result.stdout.trim()}`,
			}),
		);
	});
}
