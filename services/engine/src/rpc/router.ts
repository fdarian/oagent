import '@orpc/experimental-effect/extensions/effect';
import '@orpc/experimental-effect/extensions/input-output';
import type { WithEffectContext } from '@orpc/experimental-effect';
import { os } from '@orpc/server';
import { Effect } from 'effect';
import * as v from 'valibot';
import { Agents } from '../agents.ts';
import { HarnessModelError } from '../harness.ts';
import { HarnessRegistry } from '../harness-registry.ts';
import { Harnesses, type HarnessRecord } from '../harnesses.ts';
import { Jobs } from '../jobs.ts';
import { requestLogFields } from '../request-log.ts';
import { Sessions } from '../sessions.ts';
import { Settings } from '../settings.ts';
import { SideChats } from '../side-chats.ts';
import { validateWorktreeTemplate } from '../worktree.ts';

export type EngineServices =
	| Jobs
	| Sessions
	| SideChats
	| Harnesses
	| Settings
	| HarnessRegistry
	| Agents;
export type EngineContext = WithEffectContext<EngineServices>;

const procedure = os.$context<EngineContext>();

function normalizeReasoningEffort(value: string | null): string | undefined {
	if (value === null || value.length === 0) return undefined;
	return value;
}

const backendSchema = v.picklist([
	'opencode',
	'cursor',
	'grok',
	'codex',
	'claude',
]);
const reasoningEffortSchema = v.optional(v.pipe(v.string(), v.nonEmpty()));
const agentNameSchema = v.pipe(v.string(), v.nonEmpty());
const agentTargetSchema = v.object({
	backend: backendSchema,
	target: v.pipe(v.string(), v.nonEmpty()),
});

const harnessEnvEntrySchema = v.object({
	key: v.pipe(
		v.string(),
		v.check((value) => value.trim().length > 0, 'Environment key is required'),
	),
	value: v.string(),
});
const harnessEnvEntriesSchema = v.pipe(
	v.array(harnessEnvEntrySchema),
	v.check(
		(entries) =>
			new Set(entries.map((entry) => entry.key)).size === entries.length,
		'Environment keys must be unique',
	),
);

const toHarnessDto = (harness: HarnessRecord) => ({
	backend: harness.backend,
	binaryPath: harness.binaryPath,
	version: harness.version,
	detectedAt: harness.detectedAt.getTime(),
});

const toHarnessEnvOutput = (env: Readonly<Record<string, string>>) => ({
	env: Object.entries(env).map((entry) => ({
		key: entry[0],
		value: entry[1],
	})),
});

function toHarnessEnvRecord(
	entries: ReadonlyArray<{ key: string; value: string }>,
): Record<string, string> {
	const env = Object.create(null) as Record<string, string>;
	for (const entry of entries) {
		env[entry.key] = entry.value;
	}
	return env;
}

type HarnessEnvSettings = Pick<
	Settings['Service'],
	'getHarnessEnv' | 'setHarnessEnv'
>;

export const createHarnessEnvProcedures = (settings: HarnessEnvSettings) =>
	Effect.succeed({
		getHarnessEnv: os
			.input(v.object({ backend: backendSchema }))
			.effect(function* (options) {
				return yield* Effect.sync(() =>
					toHarnessEnvOutput(settings.getHarnessEnv(options.input.backend)),
				);
			}),
		setHarnessEnv: os
			.input(
				v.object({
					backend: backendSchema,
					env: harnessEnvEntriesSchema,
				}),
			)
			.effect(function* (options) {
				return yield* Effect.sync(() => {
					const env = toHarnessEnvRecord(options.input.env);
					settings.setHarnessEnv(options.input.backend, env);
					return toHarnessEnvOutput(env);
				});
			}),
	});

type AliasRow = {
	name: string;
	backend: string;
	model_id: string;
	reasoning_effort?: string | null;
	description?: string | null;
};

const toAliasDto = (alias: AliasRow) => {
	const reasoningEffort =
		alias.reasoning_effort === undefined || alias.reasoning_effort === null
			? undefined
			: normalizeReasoningEffort(alias.reasoning_effort);
	const description = alias.description;
	return {
		name: alias.name,
		backend: alias.backend,
		model_id: alias.model_id,
		...(reasoningEffort === undefined
			? {}
			: { reasoning_effort: reasoningEffort }),
		...(description === undefined || description === null
			? {}
			: { description }),
	};
};

const router = procedure.router({
	jobs: {
		list: procedure.input(v.void_()).effect(function* () {
			const jobs = yield* Jobs;
			return jobs.list();
		}),
		get: procedure
			.input(v.object({ jobId: v.string() }))
			.effect(function* (options) {
				const jobs = yield* Jobs;
				const job = jobs.getRootJobMetadata(options.input.jobId);
				if (job === undefined) return undefined;
				return {
					id: job.id,
					status: job.status,
					createdAt: job.createdAt,
					terminatedAt: job.terminatedAt,
					prompt: job.prompt,
					cwd: job.cwd,
					backend: job.backend,
					model: job.model,
					agentType: job.agentType,
					sessionId: job.sessionId,
					harnessSessionId: job.harnessSessionId,
					worktreePath: job.worktreePath,
					worktreeBranch: job.worktreeBranch,
				};
			}),
		start: procedure
			.input(
				v.object({
					prompt: v.string(),
					cwd: v.string(),
					model: v.optional(v.string()),
					agent_type: v.optional(v.string()),
					sessionId: v.optional(v.string()),
					worktree: v.optional(v.boolean()),
				}),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				const result =
					options.input.sessionId === undefined
						? yield* sessions.start({
								prompt: options.input.prompt,
								cwd: options.input.cwd,
								model: options.input.model,
								agentType: options.input.agent_type,
								worktree: options.input.worktree,
							})
						: yield* sessions.sendMessage({
								sessionId: options.input.sessionId,
								prompt: options.input.prompt,
							});
				yield* Effect.logInfo(
					`RPC start accepted ${requestLogFields({
						jobId: result.jobId,
						sessionId: options.input.sessionId,
					})}`,
				);
				return result;
			}),
		cancel: procedure
			.input(v.object({ jobId: v.string() }))
			.effect(function* (options) {
				const jobs = yield* Jobs;
				return yield* jobs.cancel(options.input).pipe(
					Effect.map(() => ({ ok: true })),
					Effect.catchTag('JobNotFound', () => Effect.succeed({ ok: false })),
				);
			}),
		steer: procedure
			.input(v.object({ jobId: v.string(), prompt: v.string() }))
			.effect(function* (options) {
				const jobs = yield* Jobs;
				const sessionId = jobs.getJobMetadata(options.input.jobId)?.sessionId;
				yield* Effect.logInfo(
					`RPC steer ${requestLogFields({
						jobId: options.input.jobId,
						sessionId,
					})}`,
				);
				yield* jobs.steer(options.input.jobId, options.input.prompt);
				return { ok: true as const };
			}),
		wait: procedure
			.input(
				v.object({
					jobId: v.string(),
					timeoutMs: v.optional(v.number()),
				}),
			)
			.effect(function* (options) {
				const jobs = yield* Jobs;
				const sessionId = jobs.getJobMetadata(options.input.jobId)?.sessionId;
				yield* Effect.logInfo(
					`RPC wait ${requestLogFields({
						jobId: options.input.jobId,
						sessionId,
					})}`,
				);
				return yield* jobs.wait(options.input).pipe(
					Effect.catchTag('JobNotFound', (error) =>
						Effect.succeed({
							status: 'error' as const,
							message: `Job not found: ${error.jobId}`,
						}),
					),
				);
			}),
	},
	sessions: {
		start: procedure
			.input(
				v.object({
					prompt: v.string(),
					cwd: v.optional(v.string()),
					model: v.optional(v.string()),
					agent_type: v.optional(v.string()),
					forkId: v.optional(v.string()),
					worktree: v.optional(v.boolean()),
					mcpSessionId: v.optional(v.string()),
				}),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.start({
					prompt: options.input.prompt,
					cwd: options.input.cwd,
					model: options.input.model,
					agentType: options.input.agent_type,
					forkId: options.input.forkId,
					worktree: options.input.worktree,
					mcpSessionId: options.input.mcpSessionId,
				});
			}),
		sendMessage: procedure
			.input(v.object({ sessionId: v.string(), prompt: v.string() }))
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.sendMessage(options.input);
			}),
		read: procedure
			.input(
				v.object({
					sessionId: v.string(),
					timeoutMs: v.optional(v.number()),
				}),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.read(options.input);
			}),
		cancel: procedure
			.input(v.object({ sessionId: v.string() }))
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.cancel(options.input);
			}),
		list: procedure
			.input(v.object({ mcpSessionId: v.string() }))
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.list(options.input);
			}),
	},
	sideChats: {
		list: procedure
			.input(v.object({ sourceJobId: v.string() }))
			.effect(function* (options) {
				const sideChats = yield* SideChats;
				return yield* sideChats.list(options.input.sourceJobId);
			}),
		create: procedure
			.input(v.object({ sourceJobId: v.string() }))
			.effect(function* (options) {
				const sideChats = yield* SideChats;
				return yield* sideChats.create(options.input.sourceJobId);
			}),
		send: procedure
			.input(
				v.object({
					sideChatId: v.string(),
					prompt: v.pipe(v.string(), v.nonEmpty()),
				}),
			)
			.effect(function* (options) {
				const sideChats = yield* SideChats;
				return yield* sideChats.send(options.input);
			}),
	},
	aliases: {
		list: procedure.input(v.void_()).effect(function* () {
			const jobs = yield* Jobs;
			return jobs.listAliases().map(toAliasDto);
		}),
		save: procedure
			.input(
				v.object({
					name: v.pipe(v.string(), v.nonEmpty(), v.regex(/^[a-z0-9-]+$/)),
					backend: backendSchema,
					model_id: v.pipe(v.string(), v.nonEmpty()),
					reasoning_effort: reasoningEffortSchema,
					description: v.optional(v.string()),
				}),
			)
			.effect(function* (options) {
				const jobs = yield* Jobs;
				return toAliasDto(
					jobs.saveAlias({
						name: options.input.name,
						backend: options.input.backend,
						model_id: options.input.model_id,
						reasoning_effort: options.input.reasoning_effort,
						description: options.input.description,
					}),
				);
			}),
		delete: procedure
			.input(v.object({ name: v.string() }))
			.effect(function* (options) {
				const jobs = yield* Jobs;
				return { ok: jobs.deleteAlias(options.input.name) };
			}),
	},
	agents: {
		list: procedure.input(v.void_()).effect(function* () {
			const agents = yield* Agents;
			return agents.list();
		}),
		save: procedure
			.input(
				v.object({
					name: agentNameSchema,
					description: v.optional(v.nullable(v.string())),
					targets: v.array(agentTargetSchema),
				}),
			)
			.effect(function* (options) {
				const agents = yield* Agents;
				return agents.save(options.input);
			}),
		delete: procedure
			.input(v.object({ name: agentNameSchema }))
			.effect(function* (options) {
				const agents = yield* Agents;
				return { ok: agents.delete(options.input.name) };
			}),
		targets: procedure
			.input(v.object({ backend: backendSchema }))
			.effect(function* (options) {
				const harnessRegistry = yield* HarnessRegistry;
				return yield* harnessRegistry
					.listAgentTargets(options.input.backend)
					.pipe(
						Effect.mapError(
							(cause) =>
								new HarnessModelError({
									backend: options.input.backend,
									message: `Failed to list agent targets for ${options.input.backend}: ${String(cause)}`,
								}),
						),
					);
			}),
	},
	settings: {
		getWorktree: procedure.input(v.void_()).effect(function* () {
			const settings = yield* Settings;
			return settings.getWorktree();
		}),
		setWorktree: procedure
			.input(
				v.pipe(
					v.object({
						enabled: v.boolean(),
						createCommand: v.string(),
					}),
					v.check(
						(value) =>
							!value.enabled ||
							(value.createCommand.trim().length > 0 &&
								validateWorktreeTemplate(value.createCommand)),
						'Enabled worktrees require a nonblank command with only {{branch}}, {{base}}, and {{repo}} variables.',
					),
				),
			)
			.effect(function* (options) {
				const settings = yield* Settings;
				settings.setWorktree(options.input);
				return settings.getWorktree();
			}),
		getStartTimeout: procedure.input(v.void_()).effect(function* () {
			const jobs = yield* Jobs;
			return { minutes: jobs.getStartTimeoutMs() / 60000 };
		}),
		setStartTimeout: procedure
			.input(
				v.object({
					minutes: v.pipe(v.number(), v.integer(), v.minValue(1)),
				}),
			)
			.effect(function* (options) {
				const settings = yield* Settings;
				settings.setSetting(
					'start_timeout_ms',
					String(options.input.minutes * 60000),
				);
				return { minutes: options.input.minutes };
			}),
		getCodexHome: procedure.input(v.void_()).effect(function* () {
			const settings = yield* Settings;
			return { home: settings.getCodexHome() };
		}),
		setCodexHome: procedure
			.input(v.object({ home: v.optional(v.nullable(v.string())) }))
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				const settings = yield* Settings;
				const harnessRegistry = yield* HarnessRegistry;
				yield* harnesses.cancelLogin('codex');
				settings.setCodexHome(options.input.home);
				yield* harnessRegistry.get('codex').invalidate();
				return { home: settings.getCodexHome() };
			}),
		getHarnessEnv: procedure
			.input(v.object({ backend: backendSchema }))
			.effect(function* (options) {
				const settings = yield* Settings;
				return toHarnessEnvOutput(
					settings.getHarnessEnv(options.input.backend),
				);
			}),
		setHarnessEnv: procedure
			.input(
				v.object({
					backend: backendSchema,
					env: harnessEnvEntriesSchema,
				}),
			)
			.effect(function* (options) {
				const settings = yield* Settings;
				const env = toHarnessEnvRecord(options.input.env);
				settings.setHarnessEnv(options.input.backend, env);
				return toHarnessEnvOutput(env);
			}),
		getHarnessTransport: procedure
			.input(v.object({ backend: backendSchema }))
			.effect(function* (options) {
				const settings = yield* Settings;
				return {
					transport: settings.getHarnessTransport(options.input.backend),
				};
			}),
		setHarnessTransport: procedure
			.input(
				v.object({
					backend: backendSchema,
					transport: v.picklist(['acp', 'api']),
				}),
			)
			.effect(function* (options) {
				const settings = yield* Settings;
				if (options.input.transport === 'api') {
					if (options.input.backend !== 'opencode') {
						return yield* Effect.fail(
							new Error('API transport is only supported for OpenCode'),
						);
					}
					const registry = yield* HarnessRegistry;
					const version = yield* registry.get('opencode').version();
					if (version === undefined || !/^[2-9]\d*\./.test(version)) {
						return yield* Effect.fail(
							new Error(
								`OpenCode API transport requires v2 or newer (detected: ${String(version)})`,
							),
						);
					}
				}
				settings.setHarnessTransport(
					options.input.backend,
					options.input.transport,
				);
				return {
					transport: settings.getHarnessTransport(options.input.backend),
				};
			}),
	},
	harnesses: {
		list: procedure.input(v.void_()).effect(function* () {
			const harnesses = yield* Harnesses;
			return (yield* harnesses.list()).map(toHarnessDto);
		}),
		refresh: procedure.input(v.void_()).effect(function* () {
			const harnesses = yield* Harnesses;
			return (yield* harnesses.refresh()).map(toHarnessDto);
		}),
		check: procedure
			.input(v.object({ backend: backendSchema }))
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				return yield* harnesses.check(options.input.backend);
			}),
		authStatus: procedure
			.input(v.object({ backend: backendSchema }))
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				return yield* harnesses.authStatus(options.input.backend);
			}),
		login: procedure
			.input(v.object({ backend: backendSchema }))
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				return yield* harnesses.login(options.input.backend);
			}),
		cancelLogin: procedure
			.input(v.object({ backend: backendSchema }))
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				return yield* harnesses.cancelLogin(options.input.backend);
			}),
		logout: procedure
			.input(v.object({ backend: backendSchema }))
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				return yield* harnesses.logout(options.input.backend);
			}),
	},
	models: {
		list: procedure
			.input(v.object({ backend: backendSchema }))
			.effect(function* (options) {
				const harnessRegistry = yield* HarnessRegistry;
				const models = yield* harnessRegistry
					.get(options.input.backend)
					.listModels()
					.pipe(
						Effect.mapError(
							(cause) =>
								new HarnessModelError({
									backend: options.input.backend,
									message: `Failed to list models for ${options.input.backend}: ${String(cause)}`,
								}),
						),
					);
				return models.map((entry) => ({ id: entry.id, label: entry.label }));
			}),
		efforts: procedure
			.input(
				v.object({
					backend: backendSchema,
					model_id: v.pipe(v.string(), v.nonEmpty()),
				}),
			)
			.effect(function* (options) {
				const harnessRegistry = yield* HarnessRegistry;
				const efforts = yield* harnessRegistry
					.get(options.input.backend)
					.listModelEfforts(options.input.model_id)
					.pipe(
						Effect.mapError(
							(cause) =>
								new HarnessModelError({
									backend: options.input.backend,
									message: `Failed to list reasoning efforts for ${options.input.backend}: ${String(cause)}`,
								}),
						),
					);
				return [...efforts];
			}),
	},
});

export type EngineRouter = typeof router;
export { router };
