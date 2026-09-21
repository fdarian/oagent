import { Context, Effect, Layer, Ref, Schema, Semaphore } from 'effect';
import {
	AcpAgent,
	type AcpAgentConfig,
	type AcpConfigOption,
	checkAcpConnection,
	probeAcpConnection,
} from './acp-agent.ts';
import {
	type Harness,
	HarnessAuthError,
	type HarnessAuthStatus,
	type HarnessCancelLoginResult,
	type HarnessLoginResult,
} from './harness.ts';
import { ModelsCache } from './models-cache.ts';
import { Settings } from './settings.ts';

const CODEX_ACP_BINARY = 'codex-acp';
const CODEX_CLI_BINARY = 'codex';

type VersionState = {
	loaded: boolean;
	value: string | undefined;
};

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

class CodexAuthError extends Schema.TaggedError<CodexAuthError>()(
	'CodexAuthError',
	{
		operation: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		return this.cause instanceof Error
			? this.cause.message
			: String(this.cause);
	}
}

function toHarnessAuthError(error: CodexAuthError): HarnessAuthError {
	return new HarnessAuthError({
		operation: error.operation,
		cause: error.cause,
	});
}

function mapAuthError<A>(
	effect: Effect.Effect<A, CodexAuthError, never>,
): Effect.Effect<A, HarnessAuthError, never> {
	return effect.pipe(Effect.mapError(toHarnessAuthError));
}

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

export function getCodexBinary(): string {
	return process.env.OAGENT_CODEX_BIN ?? CODEX_ACP_BINARY;
}

export function resolveCodexBinary(): string | undefined {
	return Bun.which(getCodexBinary()) ?? undefined;
}

export function getCodexCliBinary(): string {
	return process.env.CODEX_PATH ?? CODEX_CLI_BINARY;
}

export function resolveCodexCliBinary(): string | undefined {
	return Bun.which(getCodexCliBinary()) ?? undefined;
}

export function createCodexAcpConfig(
	getCodexHome: () => string | undefined,
	getExtraEnv?: () => Record<string, string>,
): AcpAgentConfig {
	return {
		binary: resolveCodexBinary() ?? getCodexBinary(),
		args: [] as const,
		clientInfoName: 'oagent',
		env: () => {
			const configuredBinary = process.env.OAGENT_CODEX_BIN;
			const env: Record<string, string | undefined> = {};
			if (configuredBinary === undefined) {
				const codexPath = resolveCodexCliBinary();
				if (codexPath !== undefined) env.CODEX_PATH = codexPath;
			}
			const codexHome = getCodexHome();
			if (codexHome !== undefined) env.CODEX_HOME = codexHome;
			return {
				...env,
				...(getExtraEnv === undefined ? {} : getExtraEnv()),
			};
		},
	};
}

const codexAcpLayer = Layer.unwrap(
	Effect.gen(function* () {
		const settings = yield* Settings;
		return AcpAgent.layer(
			createCodexAcpConfig(settings.getCodexHome, () =>
				settings.getHarnessEnv('codex'),
			),
		);
	}),
);

function getCodexConfigOptions(
	model: string | undefined,
	reasoningEffort: string | undefined,
): ReadonlyArray<AcpConfigOption> | undefined {
	if (model === undefined) return undefined;

	const openingBracket = model.lastIndexOf('[');
	if (openingBracket === -1 || !model.endsWith(']')) {
		return [
			{ configId: 'model', value: model },
			...(reasoningEffort !== undefined
				? [{ configId: 'reasoning_effort', value: reasoningEffort }]
				: []),
		];
	}

	const modelId = model.slice(0, openingBracket);
	const suffixEffort = model.slice(openingBracket + 1, -1);
	if (modelId.length === 0 || suffixEffort.length === 0) {
		return [{ configId: 'model', value: model }];
	}
	const selectedEffort =
		reasoningEffort !== undefined ? reasoningEffort : suffixEffort;

	return [
		{ configId: 'model', value: modelId },
		...(selectedEffort !== undefined && selectedEffort.length > 0
			? [{ configId: 'reasoning_effort', value: selectedEffort }]
			: []),
	];
}

function getCodexModelId(model: string): string {
	const openingBracket = model.lastIndexOf('[');
	if (openingBracket === -1 || !model.endsWith(']')) return model;

	const modelId = model.slice(0, openingBracket);
	const reasoningEffort = model.slice(openingBracket + 1, -1);
	return modelId.length === 0 || reasoningEffort.length === 0 ? model : modelId;
}

export class Codex extends Context.Service<Codex>()('oagent/Codex', {
	make: Effect.gen(function* () {
		const acpAgent = yield* AcpAgent;
		const settings = yield* Settings;
		const createConfig = () =>
			createCodexAcpConfig(settings.getCodexHome, () =>
				settings.getHarnessEnv('codex'),
			);
		const check = () => checkAcpConnection('codex', createConfig());
		const versionRef = yield* Ref.make<VersionState>({
			loaded: false,
			value: undefined,
		});
		const versionSemaphore = yield* Semaphore.make(1);
		const version = () =>
			versionSemaphore.withPermit(
				Effect.gen(function* () {
					const memoized = yield* Ref.get(versionRef);
					if (memoized.loaded) return memoized.value;
					const info = yield* probeAcpConnection(createConfig());
					yield* Ref.set(versionRef, {
						loaded: true,
						value: info.agentVersion,
					});
					return info.agentVersion;
				}),
			);
		const fetchModels = () =>
			acpAgent.listModels().pipe(
				Effect.map((models) => {
					const seen = new Set<string>();
					const result: Array<{ id: string }> = [];
					for (const model of models) {
						const id = getCodexModelId(model.id);
						if (seen.has(id)) continue;
						seen.add(id);
						result.push({ id });
					}
					return result;
				}),
			);
		const modelCache = yield* ModelsCache.make(() => fetchModels());
		const listModels = () => modelCache.get();
		const listModelEfforts = () => Effect.succeed([]);
		const invalidate = () => modelCache.invalidate();
		const pendingLogin = yield* Ref.make<PendingLogin | undefined>(undefined);

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
		): Effect.Effect<CodexCommandResult, CodexAuthError> =>
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
							catch: (cause) => new CodexAuthError({ operation, cause }),
						}),
						(child) =>
							Effect.sync(() => {
								if (child.exitCode === null) child.kill();
							}),
					);
					const stdout = yield* Effect.tryPromise({
						try: () => new Response(childProcess.stdout).text(),
						catch: (cause) => new CodexAuthError({ operation, cause }),
					});
					const stderr = yield* Effect.tryPromise({
						try: () => new Response(childProcess.stderr).text(),
						catch: (cause) => new CodexAuthError({ operation, cause }),
					});
					const exitCode = yield* Effect.tryPromise({
						try: () => childProcess.exited,
						catch: (cause) => new CodexAuthError({ operation, cause }),
					});
					return { exitCode, stdout, stderr };
				}),
			).pipe(
				Effect.timeout(AUTH_COMMAND_TIMEOUT_MS),
				Effect.mapError((cause) =>
					cause instanceof CodexAuthError
						? cause
						: new CodexAuthError({ operation, cause }),
				),
			);

		const clearPendingLogin = (process: Bun.Subprocess) =>
			Ref.update(pendingLogin, (pending) =>
				pending?.process === process ? undefined : pending,
			);

		const readLoginPrompt = (
			process: Bun.Subprocess,
		): Effect.Effect<LoginPrompt, CodexAuthError> =>
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
				catch: (cause) => new CodexAuthError({ operation: 'login', cause }),
			});

		const drainLoginStream = (stream: ReadableStream<Uint8Array>) =>
			Effect.tryPromise({
				try: () => new Response(stream).arrayBuffer(),
				catch: (cause) => new CodexAuthError({ operation: 'login', cause }),
			}).pipe(
				Effect.map(() => undefined),
				Effect.catch(() => Effect.succeed(undefined)),
			);

		const monitorLogin = (process: Bun.Subprocess) =>
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
						catch: (cause) => new CodexAuthError({ operation: 'login', cause }),
					}),
					Effect.sleep(AUTH_LOGIN_TIMEOUT_MS),
				);
				if (exitCode === 0) yield* invalidate();
				if (process.exitCode === null) process.kill();
			}).pipe(
				Effect.catch(() => Effect.succeed(undefined)),
				Effect.ensuring(clearPendingLogin(process)),
			);

		const authStatus = (): Effect.Effect<HarnessAuthStatus, CodexAuthError> =>
			Effect.gen(function* () {
				const pending = yield* Ref.get(pendingLogin);
				if (pending !== undefined) {
					return { backend: 'codex', status: 'pending' as const };
				}
				const binary = resolveCodexCliBinary();
				if (binary === undefined) {
					return { backend: 'codex', status: 'unsupported' as const };
				}
				const result = yield* runCodexCommand(
					binary,
					['login', 'status'],
					'authStatus',
				);
				const output = commandOutput(result);
				if (result.exitCode === 0) {
					return {
						backend: 'codex',
						status: 'logged_in' as const,
						...(output.match(/chatgpt/i) !== null ? { method: 'chatgpt' } : {}),
					};
				}
				if (/not logged in/i.test(output)) {
					return { backend: 'codex', status: 'logged_out' as const };
				}
				const message =
					output.length > 0
						? output
						: `codex login status exited with code ${result.exitCode}`;
				return yield* new CodexAuthError({
					operation: 'authStatus',
					cause: new Error(message),
				});
			});

		const login = (): Effect.Effect<HarnessLoginResult, CodexAuthError> =>
			Effect.gen(function* () {
				const pending = yield* Ref.get(pendingLogin);
				if (pending !== undefined) {
					if (pending.prompt === undefined) {
						return yield* new CodexAuthError({
							operation: 'login',
							cause: new Error('Codex login is already starting'),
						});
					}
					return {
						backend: 'codex',
						status: 'pending' as const,
						...pending.prompt,
					};
				}
				const binary = resolveCodexCliBinary();
				if (binary === undefined) {
					return { backend: 'codex', status: 'unsupported' as const };
				}
				const childProcess = yield* Effect.try({
					try: () =>
						Bun.spawn([binary, 'login', '--device-auth'], {
							stdin: 'ignore',
							stdout: 'pipe',
							stderr: 'pipe',
							cwd: process.cwd(),
							env: createCodexEnv(true),
						}),
					catch: (cause) => new CodexAuthError({ operation: 'login', cause }),
				});
				yield* Ref.set(pendingLogin, { process: childProcess });
				const prompt = yield* readLoginPrompt(childProcess).pipe(
					Effect.timeout(AUTH_PROMPT_TIMEOUT_MS),
					Effect.catchTag(
						'TimeoutError',
						() =>
							new CodexAuthError({
								operation: 'login',
								cause: new Error(
									'Codex login did not show a device code within 15 seconds',
								),
							}),
					),
					Effect.tapError(() =>
						Effect.gen(function* () {
							yield* Effect.sync(() => childProcess.kill());
							yield* clearPendingLogin(childProcess);
						}),
					),
				);
				yield* Ref.set(pendingLogin, { process: childProcess, prompt });
				yield* Effect.forkDetach(Effect.scoped(monitorLogin(childProcess)));
				return { backend: 'codex', status: 'pending' as const, ...prompt };
			});

		const cancelLogin = (): Effect.Effect<
			HarnessCancelLoginResult,
			CodexAuthError
		> =>
			Effect.gen(function* () {
				const pending = yield* Ref.get(pendingLogin);
				if (pending === undefined) {
					return { backend: 'codex', cancelled: false };
				}
				yield* Effect.try({
					try: () => pending.process.kill(),
					catch: (cause) =>
						new CodexAuthError({ operation: 'cancelLogin', cause }),
				});
				yield* Ref.set(pendingLogin, undefined);
				return { backend: 'codex', cancelled: true };
			});

		const logout = (): Effect.Effect<HarnessAuthStatus, CodexAuthError> =>
			Effect.gen(function* () {
				yield* cancelLogin();
				const binary = resolveCodexCliBinary();
				if (binary === undefined) {
					return { backend: 'codex', status: 'unsupported' as const };
				}
				const result = yield* runCodexCommand(binary, ['logout'], 'logout');
				if (result.exitCode !== 0) {
					const output = commandOutput(result);
					const message =
						output.length > 0
							? output
							: `codex logout exited with code ${result.exitCode}`;
					return yield* new CodexAuthError({
						operation: 'logout',
						cause: new Error(message),
					});
				}
				yield* invalidate();
				return { backend: 'codex', status: 'logged_out' as const };
			});

		const auth = {
			authStatus: () => mapAuthError(authStatus()),
			login: () => mapAuthError(login()),
			cancelLogin: () => mapAuthError(cancelLogin()),
			logout: () => mapAuthError(logout()),
		};

		return {
			backend: 'codex',
			runTurn: (input: Parameters<typeof acpAgent.runTurn>[0]) => {
				const configOptions = getCodexConfigOptions(
					input.model,
					input.reasoningEffort,
				);
				return acpAgent.runTurn({
					...input,
					model: undefined,
					configOptions,
				});
			},
			listModels,
			listModelEfforts,
			listAgentTargets: () => Effect.succeed([]),
			resolveBinary: resolveCodexBinary,
			version,
			invalidate,
			check,
			auth,
		} satisfies Harness;
	}),
}) {
	static readonly layer = Layer.effect(Codex, Codex.make).pipe(
		Layer.provide(codexAcpLayer),
		Layer.provide(Settings.layer),
	);
}
