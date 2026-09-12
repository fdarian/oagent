import fs from 'node:fs';
import path from 'node:path';
import { Effect } from 'effect';
import { ServiceError } from '#/lib/service/errors.ts';

export type ManagedServerStatus = {
	pid: number | undefined;
	running: boolean;
};

export type StartManagedServerResult = {
	started: boolean;
	pid: number;
};

export type StopManagedServerResult = {
	stopped: boolean;
	pid: number | undefined;
};

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function isMissingProcess(cause: unknown): boolean {
	return cause instanceof Error && 'code' in cause && cause.code === 'ESRCH';
}

function isOagentServeCommand(command: string): boolean {
	const tokens = command.trim().split(/\s+/);
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === undefined) {
			continue;
		}

		const commandName = path.basename(token);
		if (
			commandName !== 'oagent' &&
			!commandName.endsWith('oagent') &&
			commandName !== 'index.ts'
		) {
			continue;
		}

		const nextToken = tokens[index + 1];
		if (nextToken === 'serve') {
			return true;
		}
	}

	return false;
}

function readPidFile(
	pidPath: string,
): Effect.Effect<number | undefined, ServiceError> {
	return Effect.try({
		try: () => {
			if (!fs.existsSync(pidPath)) {
				return undefined;
			}

			const value = fs.readFileSync(pidPath, 'utf8').trim();
			if (!/^\d+$/.test(value)) {
				throw new ServiceError({
					message: `Unable to parse server PID from ${pidPath}`,
				});
			}

			const pid = Number.parseInt(value, 10);
			if (!Number.isInteger(pid) || pid < 1) {
				throw new ServiceError({
					message: `Unable to parse server PID from ${pidPath}`,
				});
			}

			return pid;
		},
		catch: (cause) =>
			cause instanceof ServiceError
				? cause
				: new ServiceError({
						message: `Unable to read server PID from ${pidPath}: ${errorMessage(cause)}`,
					}),
	});
}

function waitForProcessExit(pid: number): Effect.Effect<void, ServiceError> {
	return Effect.tryPromise({
		try: async () => {
			const deadline = Date.now() + 2_000;
			while (Date.now() < deadline) {
				try {
					process.kill(pid, 0);
				} catch (cause) {
					if (isMissingProcess(cause)) {
						return;
					}
					throw cause;
				}
				await Bun.sleep(50);
			}

			try {
				process.kill(pid, 'SIGKILL');
			} catch (cause) {
				if (!isMissingProcess(cause)) {
					throw cause;
				}
			}
		},
		catch: (cause) =>
			new ServiceError({
				message: `Failed to wait for oagent serve (pid ${pid}) to stop: ${errorMessage(cause)}`,
			}),
	});
}

function removePidFile(pidPath: string): Effect.Effect<void, ServiceError> {
	return Effect.try({
		try: () => {
			try {
				fs.rmSync(pidPath);
			} catch (cause) {
				if (
					!(
						cause instanceof Error &&
						'code' in cause &&
						cause.code === 'ENOENT'
					)
				) {
					throw cause;
				}
			}
		},
		catch: (cause) =>
			new ServiceError({
				message: `Failed to remove server PID file: ${errorMessage(cause)}`,
			}),
	});
}

function readProcessCommand(
	pid: number,
): Effect.Effect<string | undefined, ServiceError> {
	return Effect.tryPromise({
		try: async () => {
			const proc = Bun.spawn(['ps', '-p', String(pid), '-o', 'command='], {
				stdout: 'pipe',
				stderr: 'pipe',
			});
			const stdout = await new Response(proc.stdout).text();
			await proc.exited;
			if (proc.exitCode !== 0) {
				return undefined;
			}

			const command = stdout.trim();
			return command.length > 0 ? command : undefined;
		},
		catch: (cause) =>
			new ServiceError({
				message: `Unable to inspect server process: ${errorMessage(cause)}`,
			}),
	});
}

export function loadManagedServerStatus(
	pidPath: string,
): Effect.Effect<ManagedServerStatus, ServiceError> {
	return Effect.gen(function* () {
		const pid = yield* readPidFile(pidPath);
		if (pid === undefined) {
			return { pid: undefined, running: false };
		}

		const command = yield* readProcessCommand(pid);
		if (command === undefined || !isOagentServeCommand(command)) {
			yield* removePidFile(pidPath);
			return { pid: undefined, running: false };
		}

		return { pid, running: true };
	});
}

export function startManagedServer(params: {
	command: ReadonlyArray<string>;
	pidPath: string;
}): Effect.Effect<StartManagedServerResult, ServiceError> {
	return Effect.gen(function* () {
		const current = yield* loadManagedServerStatus(params.pidPath);
		if (current.running && current.pid !== undefined) {
			return { started: false, pid: current.pid };
		}

		const child = yield* Effect.try({
			try: () => {
				const spawned = Bun.spawn([...params.command], {
					detached: true,
					stdin: 'ignore',
					stdout: 'ignore',
					stderr: 'ignore',
				});
				spawned.unref();
				return spawned;
			},
			catch: (cause) =>
				new ServiceError({
					message: `Failed to start oagent serve: ${errorMessage(cause)}`,
				}),
		});

		yield* Effect.try({
			try: () => {
				try {
					fs.writeFileSync(params.pidPath, `${child.pid}\n`, 'utf8');
				} catch (cause) {
					child.kill();
					throw cause;
				}
			},
			catch: (cause) =>
				new ServiceError({
					message: `Failed to record server PID: ${errorMessage(cause)}`,
				}),
		});

		return { started: true, pid: child.pid };
	});
}

export function stopManagedServer(
	pidPath: string,
): Effect.Effect<StopManagedServerResult, ServiceError> {
	return Effect.gen(function* () {
		const current = yield* loadManagedServerStatus(pidPath);
		if (!current.running || current.pid === undefined) {
			return { stopped: false, pid: undefined };
		}

		const pid = current.pid;
		yield* Effect.try({
			try: () => {
				try {
					process.kill(pid, 'SIGTERM');
				} catch (cause) {
					if (!isMissingProcess(cause)) {
						throw cause;
					}
				}
			},
			catch: (cause) =>
				new ServiceError({
					message: `Failed to stop oagent serve (pid ${pid}): ${errorMessage(cause)}`,
				}),
		});
		yield* waitForProcessExit(pid);

		yield* removePidFile(pidPath);
		return { stopped: true, pid };
	});
}
