import '@orpc/experimental-effect/extensions/effect';
import '@orpc/experimental-effect/extensions/input-output';
import type { WithEffectContext } from '@orpc/experimental-effect';
import { os } from '@orpc/server';
import { Effect, Schema } from 'effect';
import { Agents } from '../agents.ts';
import { AliasPresets } from '../alias-presets.ts';
import {
	type CustomHarnessDefinition,
	CustomHarnesses,
} from '../custom-harnesses.ts';
import {
	BACKENDS,
	BUILTIN_HARNESS_NAMES,
	CUSTOM_HARNESS_ID_PATTERN,
	HarnessModelError,
} from '../harness.ts';
import { HarnessRegistry } from '../harness-registry.ts';
import { Harnesses, type HarnessRecord } from '../harnesses.ts';
import { IdleExit } from '../idle.ts';
import { Jobs } from '../jobs.ts';
import { requestLogFields } from '../request-log.ts';
import { SessionCosts } from '../session-costs.ts';
import { Sessions } from '../sessions.ts';
import { Settings } from '../settings.ts';
import { SideChats } from '../side-chats.ts';
import { validateWorktreeTemplate } from '../worktree.ts';

export type EngineServices =
	| AliasPresets
	| Jobs
	| Sessions
	| SessionCosts
	| SideChats
	| Harnesses
	| Settings
	| HarnessRegistry
	| CustomHarnesses
	| Agents
	| IdleExit;
export type EngineContext = WithEffectContext<EngineServices>;

const procedure = os.$context<EngineContext>();

function normalizeReasoningEffort(value: string | null): string | undefined {
	if (value === null || value.length === 0) return undefined;
	return value;
}

const backendSchema = Schema.Literals(BACKENDS);
/** Any harness a request may address; unknown ids fail at resolution. */
const harnessIdSchema = Schema.String.check(Schema.isMinLength(1));
const customHarnessIdSchema = Schema.String.check(
	Schema.isPattern(CUSTOM_HARNESS_ID_PATTERN),
);
const customHarnessFieldsSchema = {
	name: Schema.String.check(Schema.isMinLength(1)),
	binary: Schema.String.check(Schema.isMinLength(1)),
	args: Schema.Array(Schema.String),
};
const reasoningEffortSchema = Schema.optional(
	Schema.String.check(Schema.isMinLength(1)),
);
const agentNameSchema = Schema.String.check(Schema.isMinLength(1));
const agentTargetSchema = Schema.Struct({
	backend: harnessIdSchema,
	target: Schema.String.check(Schema.isMinLength(1)),
});

const harnessEnvEntrySchema = Schema.Struct({
	key: Schema.String.check(
		Schema.makeFilter((value) => value.trim().length > 0, {
			message: 'Environment key is required',
		}),
	),
	value: Schema.String,
});
const harnessEnvEntriesSchema = Schema.Array(harnessEnvEntrySchema).check(
	Schema.makeFilter(
		(entries) =>
			new Set(entries.map((entry) => entry.key)).size === entries.length,
		{ message: 'Environment keys must be unique' },
	),
);

const toHarnessDto = (harness: HarnessRecord) => ({
	backend: harness.backend,
	binaryPath: harness.binaryPath,
	version: harness.version,
	detectedAt: harness.detectedAt.getTime(),
});

const toCustomHarnessDto = (definition: CustomHarnessDefinition) => ({
	id: definition.id,
	name: definition.name,
	binary: definition.binary,
	args: [...definition.args],
	createdAt: definition.createdAt.getTime(),
	updatedAt: definition.updatedAt.getTime(),
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
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ backend: harnessIdSchema })),
			)
			.effect(function* (options) {
				return yield* Effect.sync(() =>
					toHarnessEnvOutput(settings.getHarnessEnv(options.input.backend)),
				);
			}),
		setHarnessEnv: os
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						backend: harnessIdSchema,
						env: harnessEnvEntriesSchema,
					}),
				),
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
	daemon: {
		get: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const idleExit = yield* IdleExit;
				return { idleExit: yield* idleExit.isActive };
			}),
		disableIdleExit: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const idleExit = yield* IdleExit;
				yield* idleExit.disable;
			}),
	},
	jobs: {
		list: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const jobs = yield* Jobs;
				return jobs.list();
			}),
		get: procedure
			.input(Schema.toStandardSchemaV1(Schema.Struct({ jobId: Schema.String })))
			.effect(function* (options) {
				const jobs = yield* Jobs;
				const job = jobs.getRootJobMetadata(options.input.jobId);
				if (job === undefined) return undefined;
				return {
					id: job.id,
					title: job.title,
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
				Schema.toStandardSchemaV1(
					Schema.Struct({
						prompt: Schema.String,
						cwd: Schema.String,
						model: Schema.optional(Schema.String),
						agent_type: Schema.optional(Schema.String),
						title: Schema.optional(Schema.String),
						sessionId: Schema.optional(Schema.String),
						worktree: Schema.optional(Schema.Boolean),
					}).check(
						Schema.makeFilter(
							(input) =>
								input.sessionId !== undefined || input.title !== undefined,
							{ message: 'title is required when creating a session' },
						),
					),
				),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				const result = yield* Effect.gen(function* () {
					if (options.input.sessionId !== undefined) {
						return yield* sessions.sendMessage({
							sessionId: options.input.sessionId,
							prompt: options.input.prompt,
						});
					}
					if (options.input.title === undefined) {
						return yield* Effect.fail(
							new Error('title is required when creating a session'),
						);
					}
					return yield* sessions.start({
						title: options.input.title,
						prompt: options.input.prompt,
						cwd: options.input.cwd,
						model: options.input.model,
						agentType: options.input.agent_type,
						worktree: options.input.worktree === true ? {} : undefined,
					});
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
			.input(Schema.toStandardSchemaV1(Schema.Struct({ jobId: Schema.String })))
			.effect(function* (options) {
				const jobs = yield* Jobs;
				return yield* jobs.cancel(options.input).pipe(
					Effect.map(() => ({ ok: true })),
					Effect.catchTag('JobNotFound', () => Effect.succeed({ ok: false })),
				);
			}),
		steer: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({ jobId: Schema.String, prompt: Schema.String }),
				),
			)
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
				Schema.toStandardSchemaV1(
					Schema.Struct({
						jobId: Schema.String,
						timeoutMs: Schema.optional(
							Schema.Number.check(
								Schema.makeFilter((value) => !Number.isNaN(value)),
							),
						),
					}),
				),
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
				Schema.toStandardSchemaV1(
					Schema.Struct({
						title: Schema.String,
						agent: Schema.optional(
							Schema.Struct({
								name: agentNameSchema,
								description: Schema.optional(Schema.String),
								targets: Schema.Array(agentTargetSchema),
							}),
						),
						prompt: Schema.String,
						cwd: Schema.optional(Schema.String),
						model: Schema.optional(Schema.String),
						agent_type: Schema.optional(Schema.String),
						forkId: Schema.optional(Schema.String),
						acp: Schema.optional(
							Schema.Struct({
								binary: Schema.String,
								args: Schema.Array(Schema.String),
							}),
						),
						worktree: Schema.optional(
							Schema.Struct({
								branch: Schema.optional(Schema.String),
								base: Schema.optional(Schema.String),
							}),
						),
					}),
				),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.start({
					acp: options.input.acp,
					title: options.input.title,
					prompt: options.input.prompt,
					cwd: options.input.cwd,
					model: options.input.model,
					agent: options.input.agent,
					agentType: options.input.agent_type,
					forkId: options.input.forkId,
					worktree: options.input.worktree,
				});
			}),
		sendMessage: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({ sessionId: Schema.String, prompt: Schema.String }),
				),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.sendMessage(options.input);
			}),
		setModel: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						sessionId: Schema.String,
						model: Schema.String.check(Schema.isMinLength(1)),
					}),
				),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.setModel(
					options.input.sessionId,
					options.input.model,
				);
			}),
		result: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						sessionId: Schema.String,
						wait: Schema.optional(Schema.Boolean),
					}),
				),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.result(options.input);
			}),
		history: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						sessionId: Schema.String,
						jobId: Schema.optional(Schema.String),
						limit: Schema.optional(Schema.Int),
						before: Schema.optional(Schema.String),
					}),
				),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.history(options.input);
			}),
		cancel: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ sessionId: Schema.String })),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.cancel(options.input);
			}),
		list: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({ cwd: Schema.optional(Schema.String) }),
				),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.list(options.input);
			}),
		get: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ sessionId: Schema.String })),
			)
			.effect(function* (options) {
				const sessions = yield* Sessions;
				return yield* sessions.get(options.input);
			}),
		cost: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ sessionId: Schema.String })),
			)
			.effect(function* (options) {
				const costs = yield* SessionCosts;
				return yield* costs.get(options.input.sessionId);
			}),
	},
	sideChats: {
		list: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({ sourceJobId: Schema.String }),
				),
			)
			.effect(function* (options) {
				const sideChats = yield* SideChats;
				return yield* sideChats.list(options.input.sourceJobId);
			}),
		create: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({ sourceJobId: Schema.String }),
				),
			)
			.effect(function* (options) {
				const sideChats = yield* SideChats;
				return yield* sideChats.create(options.input.sourceJobId);
			}),
		send: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						sideChatId: Schema.String,
						prompt: Schema.String.check(Schema.isMinLength(1)),
					}),
				),
			)
			.effect(function* (options) {
				const sideChats = yield* SideChats;
				return yield* sideChats.send(options.input);
			}),
	},
	aliasPresets: {
		state: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const presets = yield* AliasPresets;
				return yield* presets.state();
			}),
		create: procedure
			.input(Schema.toStandardSchemaV1(Schema.Struct({ name: Schema.String })))
			.effect(function* (options) {
				const presets = yield* AliasPresets;
				return yield* presets.create(options.input.name);
			}),
		activate: procedure
			.input(Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })))
			.effect(function* (options) {
				const presets = yield* AliasPresets;
				return yield* presets.activate(options.input.id);
			}),
		save: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const presets = yield* AliasPresets;
				return yield* presets.save();
			}),
		discard: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const presets = yield* AliasPresets;
				return yield* presets.discard();
			}),
	},
	aliases: {
		list: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const jobs = yield* Jobs;
				return jobs.listAliases().map(toAliasDto);
			}),
		save: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						name: Schema.String.check(
							Schema.isMinLength(1),
							Schema.isPattern(/^[a-z0-9-]+$/),
						),
						backend: harnessIdSchema,
						model_id: Schema.String.check(Schema.isMinLength(1)),
						reasoning_effort: reasoningEffortSchema,
						description: Schema.optional(Schema.String),
					}),
				),
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
			.input(Schema.toStandardSchemaV1(Schema.Struct({ name: Schema.String })))
			.effect(function* (options) {
				const jobs = yield* Jobs;
				return { ok: jobs.deleteAlias(options.input.name) };
			}),
	},
	agents: {
		list: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const agents = yield* Agents;
				return agents.list();
			}),
		save: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						name: agentNameSchema,
						description: Schema.optional(Schema.NullOr(Schema.String)),
						targets: Schema.Array(agentTargetSchema),
					}),
				),
			)
			.effect(function* (options) {
				const agents = yield* Agents;
				return agents.save(options.input);
			}),
		delete: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ name: agentNameSchema })),
			)
			.effect(function* (options) {
				const agents = yield* Agents;
				return { ok: agents.delete(options.input.name) };
			}),
		targets: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ backend: harnessIdSchema })),
			)
			.effect(function* (options) {
				const harnessRegistry = yield* HarnessRegistry;
				return yield* harnessRegistry
					.listAgentTargets(options.input.backend)
					.pipe(
						Effect.mapError((cause) =>
							cause._tag === 'UnknownHarness'
								? cause
								: new HarnessModelError({
										backend: options.input.backend,
										message: `Failed to list agent targets for ${options.input.backend}: ${String(cause)}`,
									}),
						),
					);
			}),
	},
	settings: {
		getWorktree: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const settings = yield* Settings;
				return settings.getWorktree();
			}),
		setWorktree: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						enabled: Schema.Boolean,
						createCommand: Schema.String,
					}).check(
						Schema.makeFilter(
							(value) =>
								!value.enabled ||
								(value.createCommand.trim().length > 0 &&
									validateWorktreeTemplate(value.createCommand)),
							{
								message:
									'Enabled worktrees require a nonblank command with only {{branch}}, {{base}}, and {{repo}} variables.',
							},
						),
					),
				),
			)
			.effect(function* (options) {
				const settings = yield* Settings;
				settings.setWorktree(options.input);
				return settings.getWorktree();
			}),
		getCodexHome: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const settings = yield* Settings;
				return { home: settings.getCodexHome() };
			}),
		setCodexHome: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						home: Schema.optional(Schema.NullOr(Schema.String)),
					}),
				),
			)
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				const settings = yield* Settings;
				const harnessRegistry = yield* HarnessRegistry;
				yield* harnesses.cancelLogin('codex');
				settings.setCodexHome(options.input.home);
				yield* harnessRegistry.builtin('codex').invalidate();
				return { home: settings.getCodexHome() };
			}),
		getHarnessEnv: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ backend: harnessIdSchema })),
			)
			.effect(function* (options) {
				const settings = yield* Settings;
				yield* (yield* HarnessRegistry).resolve(options.input.backend);
				return toHarnessEnvOutput(
					settings.getHarnessEnv(options.input.backend),
				);
			}),
		setHarnessEnv: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						backend: harnessIdSchema,
						env: harnessEnvEntriesSchema,
					}),
				),
			)
			.effect(function* (options) {
				const settings = yield* Settings;
				yield* (yield* HarnessRegistry).resolve(options.input.backend);
				const env = toHarnessEnvRecord(options.input.env);
				settings.setHarnessEnv(options.input.backend, env);
				return toHarnessEnvOutput(env);
			}),
	},
	harnesses: {
		list: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const harnesses = yield* Harnesses;
				return (yield* harnesses.list()).map(toHarnessDto);
			}),
		catalog: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const customHarnesses = yield* CustomHarnesses;
				return [
					...BACKENDS.map((id) => ({
						id,
						name: BUILTIN_HARNESS_NAMES[id],
						builtin: true,
					})),
					...customHarnesses.list().map((definition) => ({
						id: definition.id,
						name: definition.name,
						builtin: false,
					})),
				];
			}),
		refresh: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const harnesses = yield* Harnesses;
				return (yield* harnesses.refresh()).map(toHarnessDto);
			}),
		check: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ backend: harnessIdSchema })),
			)
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				return yield* harnesses.check(options.input.backend);
			}),
		authStatus: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ backend: backendSchema })),
			)
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				return yield* harnesses.authStatus(options.input.backend);
			}),
		login: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ backend: backendSchema })),
			)
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				return yield* harnesses.login(options.input.backend);
			}),
		cancelLogin: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ backend: backendSchema })),
			)
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				return yield* harnesses.cancelLogin(options.input.backend);
			}),
		logout: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ backend: backendSchema })),
			)
			.effect(function* (options) {
				const harnesses = yield* Harnesses;
				return yield* harnesses.logout(options.input.backend);
			}),
	},
	customHarnesses: {
		list: procedure
			.input(Schema.toStandardSchemaV1(Schema.Void))
			.effect(function* () {
				const customHarnesses = yield* CustomHarnesses;
				return customHarnesses.list().map(toCustomHarnessDto);
			}),
		create: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						id: customHarnessIdSchema,
						...customHarnessFieldsSchema,
					}),
				),
			)
			.effect(function* (options) {
				const customHarnesses = yield* CustomHarnesses;
				return toCustomHarnessDto(yield* customHarnesses.create(options.input));
			}),
		update: procedure
			.input(
				Schema.toStandardSchemaV1(
					Schema.Struct({
						id: customHarnessIdSchema,
						...customHarnessFieldsSchema,
					}),
				),
			)
			.effect(function* (options) {
				const customHarnesses = yield* CustomHarnesses;
				return toCustomHarnessDto(yield* customHarnesses.update(options.input));
			}),
		delete: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ id: customHarnessIdSchema })),
			)
			.effect(function* (options) {
				const customHarnesses = yield* CustomHarnesses;
				yield* customHarnesses.remove(options.input.id);
				return { ok: true };
			}),
	},
	models: {
		list: procedure
			.input(
				Schema.toStandardSchemaV1(Schema.Struct({ backend: harnessIdSchema })),
			)
			.effect(function* (options) {
				const harnessRegistry = yield* HarnessRegistry;
				const harness = yield* harnessRegistry.resolve(options.input.backend);
				const models = yield* harness.listModels().pipe(
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
				Schema.toStandardSchemaV1(
					Schema.Struct({
						backend: harnessIdSchema,
						model_id: Schema.String.check(Schema.isMinLength(1)),
					}),
				),
			)
			.effect(function* (options) {
				const harnessRegistry = yield* HarnessRegistry;
				const harness = yield* harnessRegistry.resolve(options.input.backend);
				const efforts = yield* harness
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
