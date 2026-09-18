import { eq } from 'drizzle-orm';
import { Context, Effect, Layer, Schema } from 'effect';
import { probeAcpConnection } from './acp-agent.ts';
import { resolveCodexCliBinary } from './codex.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import {
	type Backend,
	type HarnessAuthStatus,
	type HarnessCancelLoginResult,
	type HarnessLoginResult,
	HarnessRegistry,
} from './harness.ts';
import { HarnessVersion } from './harness-version.ts';
import { ModelCatalog } from './model-catalog.ts';
import { Settings } from './settings.ts';

export type HarnessRecord = {
	backend: Backend;
	binaryPath: string;
	version: string | undefined;
	detectedAt: Date;
};

export type HarnessCheckResult =
	| {
			backend: Backend;
			ok: true;
			agentName?: string;
			agentVersion?: string;
	  }
	| {
			backend: Backend;
			ok: false;
			message: string;
	  };

export class HarnessesError extends Schema.TaggedError<HarnessesError>()(
	'HarnessesError',
	{
		operation: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		const detail =
			this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `${this.operation} failed: ${detail}`;
	}
}

type CodexCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type LoginPrompt = {
	verificationUrl: string;
	userCode: string;
};

type PendingLogin = {
	process: Bun.Subprocess;
	prompt?: LoginPrompt;
};

const AUTH_COMMAND_TIMEOUT_MS = 15_000;
const AUTH_PROMPT_TIMEOUT_MS = 15_000;
const AUTH_LOGIN_TIMEOUT_MS = 15 * 60 * 1_000;

function stripAnsi(value: string): string {
	const ansiPattern = new RegExp(
		`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
		'g',
	);
	return value.replace(ansiPattern, '');
}

export function parseLoginPrompt(value: string): LoginPrompt | undefined {
	const clean = stripAnsi(value);
	const urlMatch = clean.match(
		/https:\/\/auth\.openai\.com\/codex\/device(?:[/?][^\s)]*)?/,
	);
	if (urlMatch === null) return undefined;
	const codeMatch = clean.match(/\b[A-Z0-9]{3,8}-[A-Z0-9]{3,8}\b/);
	if (codeMatch === null) return undefined;
	return {
		verificationUrl: urlMatch[0],
		userCode: codeMatch[0],
	};
}

function commandOutput(result: CodexCommandResult): string {
	const parts = [result.stdout.trim(), result.stderr.trim()].filter(
		(part) => part.length > 0,
	);
	return parts.join('\n');
}

export class Harnesses extends Context.Service<Harnesses>()(
	'oagent/Harnesses',
	{
		make: Effect.gen(function* () {
			const dbService = yield* Db;
			const settings = yield* Settings;
			const harnessRegistry = yield* HarnessRegistry;
			const modelCatalog = yield* ModelCatalog;
			const harnessVersion = yield* HarnessVersion;
			const pendingLogins = new Map<Backend, PendingLogin>();

			const createCodexEnv = (includeNoBrowser = false) => {
				const env: Record<string, string | undefined> = { ...process.env };
				const codexHome = settings.getCodexHome();
				if (codexHome !== undefined) env.CODEX_HOME = codexHome;
				if (includeNoBrowser) env.NO_BROWSER = '1';
				return env;
			};

			const runCodexCommand = (
				binary: string,
				args: readonly string[],
				operation: string,
			): Effect.Effect<CodexCommandResult, HarnessesError> =>
				Effect.scoped(
					Effect.gen(function* () {
						const childProcess = yield* Effect.acquireRelease(
							Effect.try({
								try: () =>
									Bun.spawn([binary, ...args], {
										stdin: 'ignore',
										stdout: 'pipe',
										stderr: 'pipe',
										cwd: process.cwd(),
										env: createCodexEnv(),
									}),
								catch: (cause) => new HarnessesError({ operation, cause }),
							}),
							(child) =>
								Effect.sync(() => {
									if (child.exitCode === null) child.kill();
								}),
						);
						const stdout = yield* Effect.tryPromise({
							try: () => new Response(childProcess.stdout).text(),
							catch: (cause) => new HarnessesError({ operation, cause }),
						});
						const stderr = yield* Effect.tryPromise({
							try: () => new Response(childProcess.stderr).text(),
							catch: (cause) => new HarnessesError({ operation, cause }),
						});
						const exitCode = yield* Effect.tryPromise({
							try: () => childProcess.exited,
							catch: (cause) => new HarnessesError({ operation, cause }),
						});
						return { exitCode, stdout, stderr };
					}),
				).pipe(
					Effect.timeout(AUTH_COMMAND_TIMEOUT_MS),
					Effect.mapError((cause) =>
						cause instanceof HarnessesError
							? cause
							: new HarnessesError({ operation, cause }),
					),
				);

			const clearPendingLogin = (backend: Backend, process: Bun.Subprocess) => {
				const pending = pendingLogins.get(backend);
				if (pending?.process === process) pendingLogins.delete(backend);
			};

			const readLoginPrompt = (
				process: Bun.Subprocess,
			): Effect.Effect<LoginPrompt, HarnessesError> =>
				Effect.tryPromise({
					try: async () => {
						if (!(process.stdout instanceof ReadableStream)) {
							throw new Error('Codex login did not expose stdout');
						}
						const reader = process.stdout.getReader();
						const decoder = new TextDecoder();
						let output = '';
						while (true) {
							const chunk = await reader.read();
							if (chunk.done) break;
							output += decoder.decode(chunk.value, { stream: true });
							const prompt = parseLoginPrompt(output);
							if (prompt !== undefined) {
								reader.releaseLock();
								return prompt;
							}
						}
						reader.releaseLock();
						let message = stripAnsi(output).trim();
						if (process.stderr instanceof ReadableStream) {
							const stderr = await new Response(process.stderr).text();
							message = stripAnsi(`${output}\n${stderr}`).trim();
						}
						throw new Error(
							message.length > 0
								? message
								: 'Codex login exited before showing a device code',
						);
					},
					catch: (cause) => new HarnessesError({ operation: 'login', cause }),
				});

			const drainLoginStream = (stream: ReadableStream<Uint8Array>) =>
				Effect.tryPromise({
					try: () => new Response(stream).arrayBuffer(),
					catch: (cause) => new HarnessesError({ operation: 'login', cause }),
				}).pipe(
					Effect.map(() => undefined),
					Effect.catch(() => Effect.succeed(undefined)),
				);

			const monitorLogin = (backend: Backend, process: Bun.Subprocess) =>
				Effect.gen(function* () {
					const stdout = process.stdout;
					if (stdout instanceof ReadableStream) {
						yield* Effect.forkScoped(drainLoginStream(stdout));
					}
					const stderr = process.stderr;
					if (stderr instanceof ReadableStream) {
						yield* Effect.forkScoped(drainLoginStream(stderr));
					}
					const exitCode = yield* Effect.raceFirst(
						Effect.tryPromise({
							try: () => process.exited,
							catch: (cause) =>
								new HarnessesError({ operation: 'login', cause }),
						}),
						Effect.sleep(AUTH_LOGIN_TIMEOUT_MS),
					);
					if (exitCode === 0) yield* modelCatalog.invalidate('codex');
					if (process.exitCode === null) process.kill();
				}).pipe(
					Effect.catch(() => Effect.succeed(undefined)),
					Effect.ensuring(
						Effect.sync(() => clearPendingLogin(backend, process)),
					),
				);

			const readList = (): ReadonlyArray<HarnessRecord> => {
				const rows = dbService.db.select().from(schema.harnesses).all();
				const rowsByBackend = new Map(rows.map((row) => [row.backend, row]));
				return harnessRegistry.all.flatMap((harness) => {
					const row = rowsByBackend.get(harness.backend);
					if (row === undefined) return [];
					return [
						{
							backend: harness.backend,
							binaryPath: row.binary_path,
							version: row.version ?? undefined,
							detectedAt: row.detected_at,
						},
					];
				});
			};

			const list = (): Effect.Effect<
				ReadonlyArray<HarnessRecord>,
				HarnessesError
			> =>
				Effect.try({
					try: readList,
					catch: (cause) => new HarnessesError({ operation: 'list', cause }),
				});

			const refresh = (): Effect.Effect<
				ReadonlyArray<HarnessRecord>,
				HarnessesError
			> =>
				Effect.gen(function* () {
					const detected = yield* Effect.try({
						try: () =>
							harnessRegistry.all.flatMap((harness) => {
								const binaryPath = harness.resolveBinary();
								if (binaryPath === undefined) return [];
								return [{ harness, binaryPath }];
							}),
						catch: (cause) =>
							new HarnessesError({ operation: 'refresh', cause }),
					});
					const detectedBackends = new Set(
						detected.map((entry) => entry.harness.backend),
					);
					const versions = new Map<Backend, string | undefined>();
					for (const entry of detected) {
						const version = yield* entry.harness.version().pipe(
							Effect.mapError(
								(cause) => new HarnessesError({ operation: 'refresh', cause }),
							),
							Effect.catchTag('HarnessesError', (error) =>
								Effect.logWarning(
									`Failed to detect ${entry.harness.backend} version: ${error.message}`,
								).pipe(Effect.map(() => undefined)),
							),
						);
						versions.set(entry.harness.backend, version);
					}
					const detectedAt = new Date();

					yield* Effect.try({
						try: () => {
							dbService.db.transaction((tx) => {
								for (const entry of detected) {
									const version = versions.get(entry.harness.backend);
									tx.insert(schema.harnesses)
										.values({
											backend: entry.harness.backend,
											binary_path: entry.binaryPath,
											version: version === undefined ? null : version,
											detected_at: detectedAt,
										})
										.onConflictDoUpdate({
											target: schema.harnesses.backend,
											set: {
												binary_path: entry.binaryPath,
												version: version === undefined ? null : version,
												detected_at: detectedAt,
											},
										})
										.run();
								}

								for (const harness of harnessRegistry.all) {
									if (detectedBackends.has(harness.backend)) continue;
									tx.delete(schema.harnesses)
										.where(eq(schema.harnesses.backend, harness.backend))
										.run();
								}
							});
						},
						catch: (cause) =>
							new HarnessesError({ operation: 'refresh', cause }),
					});

					return yield* Effect.try({
						try: readList,
						catch: (cause) =>
							new HarnessesError({ operation: 'refresh', cause }),
					});
				});

			const check = (
				backend: Backend,
			): Effect.Effect<HarnessCheckResult, HarnessesError> =>
				Effect.gen(function* () {
					const detected = yield* list();
					const harness = detected.find((entry) => entry.backend === backend);
					if (harness === undefined) {
						return {
							backend,
							ok: false as const,
							message:
								'Harness is not detected. Refresh detection and try again.',
						};
					}

					const behavior = harnessRegistry.get(backend);

					return yield* probeAcpConnection(behavior.createConfig()).pipe(
						Effect.map((info) => ({ backend, ok: true as const, ...info })),
						Effect.catchTag('AcpSessionError', (error) =>
							Effect.succeed({
								backend,
								ok: false as const,
								message: error.message,
							}),
						),
						Effect.tap((result) =>
							result.ok
								? harnessVersion
										.set(backend, result.agentVersion, harness.binaryPath)
										.pipe(
											Effect.mapError(
												(cause) =>
													new HarnessesError({ operation: 'check', cause }),
											),
										)
								: Effect.void,
						),
					);
				});

			const authStatus = (
				backend: Backend,
			): Effect.Effect<HarnessAuthStatus, HarnessesError> =>
				Effect.gen(function* () {
					if (backend !== 'codex') return { backend, status: 'unsupported' };
					if (pendingLogins.has(backend)) {
						return { backend, status: 'pending' };
					}
					const binary = resolveCodexCliBinary();
					if (binary === undefined) return { backend, status: 'unsupported' };
					const result = yield* runCodexCommand(
						binary,
						['login', 'status'],
						'authStatus',
					);
					const output = commandOutput(result);
					if (result.exitCode === 0) {
						return {
							backend,
							status: 'logged_in' as const,
							...(output.match(/chatgpt/i) !== null
								? { method: 'chatgpt' }
								: {}),
						};
					}
					if (/not logged in/i.test(output)) {
						return { backend, status: 'logged_out' };
					}
					const message =
						output.length > 0
							? output
							: `codex login status exited with code ${result.exitCode}`;
					return yield* new HarnessesError({
						operation: 'authStatus',
						cause: new Error(message),
					});
				});

			const login = (
				backend: Backend,
			): Effect.Effect<HarnessLoginResult, HarnessesError> =>
				Effect.gen(function* () {
					if (backend !== 'codex') return { backend, status: 'unsupported' };
					const pending = pendingLogins.get(backend);
					if (pending !== undefined) {
						if (pending.prompt === undefined) {
							return yield* new HarnessesError({
								operation: 'login',
								cause: new Error('Codex login is already starting'),
							});
						}
						return { backend, status: 'pending', ...pending.prompt };
					}
					const binary = resolveCodexCliBinary();
					if (binary === undefined) return { backend, status: 'unsupported' };
					const childProcess = yield* Effect.try({
						try: () =>
							Bun.spawn([binary, 'login', '--device-auth'], {
								stdin: 'ignore',
								stdout: 'pipe',
								stderr: 'pipe',
								cwd: process.cwd(),
								env: createCodexEnv(true),
							}),
						catch: (cause) => new HarnessesError({ operation: 'login', cause }),
					});
					pendingLogins.set(backend, { process: childProcess });
					const prompt = yield* readLoginPrompt(childProcess).pipe(
						Effect.timeout(AUTH_PROMPT_TIMEOUT_MS),
						Effect.catchTag(
							'TimeoutError',
							() =>
								new HarnessesError({
									operation: 'login',
									cause: new Error(
										'Codex login did not show a device code within 15 seconds',
									),
								}),
						),
						Effect.tapError(() =>
							Effect.sync(() => {
								childProcess.kill();
								clearPendingLogin(backend, childProcess);
							}),
						),
					);
					pendingLogins.set(backend, { process: childProcess, prompt });
					yield* Effect.forkDetach(
						Effect.scoped(monitorLogin(backend, childProcess)),
					);
					return { backend, status: 'pending', ...prompt };
				});

			const cancelLogin = (
				backend: Backend,
			): Effect.Effect<HarnessCancelLoginResult, HarnessesError> =>
				Effect.try({
					try: () => {
						const pending = pendingLogins.get(backend);
						if (pending === undefined) return { backend, cancelled: false };
						pending.process.kill();
						pendingLogins.delete(backend);
						return { backend, cancelled: true };
					},
					catch: (cause) =>
						new HarnessesError({ operation: 'cancelLogin', cause }),
				});

			const logout = (
				backend: Backend,
			): Effect.Effect<HarnessAuthStatus, HarnessesError> =>
				Effect.gen(function* () {
					if (backend !== 'codex') return { backend, status: 'unsupported' };
					yield* cancelLogin(backend);
					const binary = resolveCodexCliBinary();
					if (binary === undefined) return { backend, status: 'unsupported' };
					const result = yield* runCodexCommand(binary, ['logout'], 'logout');
					if (result.exitCode !== 0) {
						const output = commandOutput(result);
						const message =
							output.length > 0
								? output
								: `codex logout exited with code ${result.exitCode}`;
						return yield* new HarnessesError({
							operation: 'logout',
							cause: new Error(message),
						});
					}
					yield* modelCatalog.invalidate('codex');
					return { backend, status: 'logged_out' };
				});

			return {
				list,
				refresh,
				check,
				authStatus,
				login,
				cancelLogin,
				logout,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(Harnesses, Harnesses.make).pipe(
		Layer.provide(Db.layer),
		Layer.provide(HarnessVersion.layer),
		Layer.provide(Settings.layer),
		Layer.provideMerge(ModelCatalog.layer),
		Layer.provideMerge(HarnessRegistry.layer),
	);
}
