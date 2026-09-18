import { os } from '@orpc/server';
import { Effect } from 'effect';
import { createHandler } from 'ff-effect/for/orpc';
import * as v from 'valibot';
import { type Harness, Harnesses } from '../harnesses.ts';
import { Jobs } from '../jobs.ts';
import { ModelCatalog } from '../model-catalog.ts';
import { Settings } from '../settings.ts';

function normalizeReasoningEffort(value: string | null): string | undefined {
	if (value === null || value.length === 0) return undefined;
	return value;
}

const backendSchema = v.picklist(['opencode', 'cursor', 'grok', 'codex']);
const reasoningEffortSchema = v.optional(v.pipe(v.string(), v.nonEmpty()));
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
const harnessEnvOutput = v.object({
	env: v.array(harnessEnvEntrySchema),
});
const harnessesOutput = v.array(
	v.object({
		backend: backendSchema,
		binaryPath: v.string(),
		detectedAt: v.number(),
	}),
);

const toHarnessDto = (harness: Harness) => ({
	backend: harness.backend,
	binaryPath: harness.binaryPath,
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
	const keys = new Set<string>();
	for (const entry of entries) {
		if (keys.has(entry.key)) {
			throw new Error('Environment keys must be unique');
		}
		keys.add(entry.key);
		env[entry.key] = entry.value;
	}
	return env;
}

type HarnessEnvSettings = Pick<
	Settings['Service'],
	'getHarnessEnv' | 'setHarnessEnv'
>;

export const createHarnessEnvProcedures = (settings: HarnessEnvSettings) =>
	Effect.gen(function* () {
		return {
			getHarnessEnv: yield* createHandler(
				os.input(v.object({ backend: backendSchema })).output(harnessEnvOutput),
				(opt) =>
					Effect.sync(() =>
						toHarnessEnvOutput(settings.getHarnessEnv(opt.input.backend)),
					),
			),
			setHarnessEnv: yield* createHandler(
				os
					.input(
						v.object({
							backend: backendSchema,
							env: harnessEnvEntriesSchema,
						}),
					)
					.output(harnessEnvOutput),
				(opt) =>
					Effect.sync(() => {
						const env = toHarnessEnvRecord(opt.input.env);
						settings.setHarnessEnv(opt.input.backend, env);
						return toHarnessEnvOutput(env);
					}),
			),
		};
	});

const harnessAuthStatusOutput = v.union([
	v.object({
		backend: backendSchema,
		status: v.literal('logged_in'),
		method: v.optional(v.string()),
		account: v.optional(v.string()),
	}),
	v.object({ backend: backendSchema, status: v.literal('logged_out') }),
	v.object({ backend: backendSchema, status: v.literal('pending') }),
	v.object({ backend: backendSchema, status: v.literal('unsupported') }),
]);

const harnessLoginOutput = v.union([
	v.object({
		backend: backendSchema,
		status: v.literal('pending'),
		verificationUrl: v.string(),
		userCode: v.string(),
	}),
	v.object({ backend: backendSchema, status: v.literal('unsupported') }),
]);

const program = Effect.gen(function* () {
	const jobs = yield* Jobs;
	const harnesses = yield* Harnesses;
	const settings = yield* Settings;
	const modelCatalog = yield* ModelCatalog;
	const harnessEnvProcedures = yield* createHarnessEnvProcedures(settings);

	return {
		jobs: {
			list: yield* createHandler(
				os.input(v.void_()).output(
					v.array(
						v.object({
							id: v.string(),
							status: v.picklist(['running', 'done', 'error', 'cancelled']),
							createdAt: v.number(),
							terminatedAt: v.optional(v.number()),
							prompt: v.string(),
							cwd: v.string(),
							backend: backendSchema,
							model: v.optional(v.string()),
							sessionId: v.optional(v.string()),
							mcpSessionId: v.optional(v.string()),
						}),
					),
				),
				() => Effect.succeed(jobs.list()),
			),
			get: yield* createHandler(
				os.input(v.object({ jobId: v.string() })).output(
					v.optional(
						v.object({
							id: v.string(),
							status: v.picklist(['running', 'done', 'error', 'cancelled']),
							createdAt: v.number(),
							terminatedAt: v.optional(v.number()),
							prompt: v.string(),
							cwd: v.string(),
							backend: backendSchema,
							model: v.optional(v.string()),
							sessionId: v.optional(v.string()),
						}),
					),
				),
				(opt) => {
					const detail = jobs.getDetail(opt.input.jobId);
					if (detail === undefined) return Effect.succeed(undefined);
					return Effect.succeed({
						id: detail.id,
						status: detail.status,
						createdAt: detail.createdAt,
						terminatedAt: detail.terminatedAt,
						prompt: detail.prompt,
						cwd: detail.cwd,
						backend: detail.backend,
						model: detail.model,
						sessionId: detail.sessionId,
					});
				},
			),
			start: yield* createHandler(
				os
					.input(
						v.object({
							prompt: v.string(),
							cwd: v.string(),
							model: v.optional(v.string()),
							sessionId: v.optional(v.string()),
						}),
					)
					.output(v.object({ jobId: v.string() })),
				Effect.fn(function* (opt) {
					return yield* jobs.start(opt.input);
				}),
			),
			cancel: yield* createHandler(
				os
					.input(v.object({ jobId: v.string() }))
					.output(v.object({ ok: v.boolean() })),
				Effect.fn(function* (opt) {
					return yield* jobs.cancel(opt.input).pipe(
						Effect.map(() => ({ ok: true })),
						Effect.catchTag('JobNotFound', () => Effect.succeed({ ok: false })),
					);
				}),
			),
			wait: yield* createHandler(
				os
					.input(
						v.object({
							jobId: v.string(),
							timeoutMs: v.optional(v.number()),
						}),
					)
					.output(
						v.union([
							v.object({ status: v.literal('running') }),
							v.object({
								status: v.literal('done'),
								sessionId: v.string(),
								text: v.string(),
								stopReason: v.optional(v.string()),
							}),
							v.object({
								status: v.literal('error'),
								message: v.string(),
								sessionId: v.optional(v.string()),
							}),
							v.object({
								status: v.literal('cancelled'),
								sessionId: v.optional(v.string()),
							}),
						]),
					),
				Effect.fn(function* (opt) {
					return yield* jobs.wait(opt.input).pipe(
						Effect.catchTag('JobNotFound', (err) =>
							Effect.succeed({
								status: 'error' as const,
								message: `Job not found: ${err.jobId}`,
							}),
						),
					);
				}),
			),
		},
		aliases: {
			list: yield* createHandler(
				os.input(v.void_()).output(
					v.array(
						v.object({
							name: v.string(),
							backend: v.string(),
							model_id: v.string(),
							reasoning_effort: reasoningEffortSchema,
							description: v.optional(v.string()),
						}),
					),
				),
				() => {
					return Effect.succeed(
						jobs.listAliases().map((row) => ({
							name: row.name,
							backend: row.backend,
							model_id: row.model_id,
							reasoning_effort: normalizeReasoningEffort(row.reasoning_effort),
							description: row.description ?? undefined,
						})),
					);
				},
			),
			save: yield* createHandler(
				os
					.input(
						v.object({
							name: v.pipe(v.string(), v.nonEmpty(), v.regex(/^[a-z0-9-]+$/)),
							backend: v.picklist(['opencode', 'cursor', 'grok', 'codex']),
							model_id: v.pipe(v.string(), v.nonEmpty()),
							reasoning_effort: reasoningEffortSchema,
							description: v.optional(v.string()),
						}),
					)
					.output(
						v.object({
							name: v.string(),
							backend: v.string(),
							model_id: v.string(),
							reasoning_effort: reasoningEffortSchema,
							description: v.optional(v.string()),
						}),
					),
				(opt) => {
					return Effect.succeed(
						jobs.saveAlias({
							name: opt.input.name,
							backend: opt.input.backend,
							model_id: opt.input.model_id,
							reasoning_effort: opt.input.reasoning_effort,
							description: opt.input.description,
						}),
					);
				},
			),
			delete: yield* createHandler(
				os
					.input(v.object({ name: v.string() }))
					.output(v.object({ ok: v.boolean() })),
				(opt) => {
					return Effect.succeed({ ok: jobs.deleteAlias(opt.input.name) });
				},
			),
		},
		settings: {
			getStartTimeout: yield* createHandler(
				os.input(v.void_()).output(v.object({ minutes: v.number() })),
				() => {
					return Effect.succeed({
						minutes: jobs.getStartTimeoutMs() / 60000,
					});
				},
			),
			setStartTimeout: yield* createHandler(
				os
					.input(
						v.object({
							minutes: v.pipe(v.number(), v.integer(), v.minValue(1)),
						}),
					)
					.output(v.object({ minutes: v.number() })),
				(opt) => {
					settings.setSetting(
						'start_timeout_ms',
						String(opt.input.minutes * 60000),
					);
					return Effect.succeed({ minutes: opt.input.minutes });
				},
			),
			getCodexHome: yield* createHandler(
				os.input(v.void_()).output(v.object({ home: v.optional(v.string()) })),
				() => Effect.succeed({ home: settings.getCodexHome() }),
			),
			setCodexHome: yield* createHandler(
				os
					.input(v.object({ home: v.optional(v.nullable(v.string())) }))
					.output(v.object({ home: v.optional(v.string()) })),
				Effect.fn(function* (opt) {
					yield* harnesses.cancelLogin('codex');
					settings.setCodexHome(opt.input.home);
					yield* modelCatalog.invalidate('codex');
					return { home: settings.getCodexHome() };
				}),
			),
			getHarnessEnv: harnessEnvProcedures.getHarnessEnv,
			setHarnessEnv: harnessEnvProcedures.setHarnessEnv,
		},
		harnesses: {
			list: yield* createHandler(
				os.input(v.void_()).output(harnessesOutput),
				Effect.fn(function* () {
					return (yield* harnesses.list()).map(toHarnessDto);
				}),
			),
			refresh: yield* createHandler(
				os.input(v.void_()).output(harnessesOutput),
				Effect.fn(function* () {
					return (yield* harnesses.refresh()).map(toHarnessDto);
				}),
			),
			check: yield* createHandler(
				os.input(v.object({ backend: backendSchema })).output(
					v.union([
						v.object({
							backend: backendSchema,
							ok: v.literal(true),
							agentName: v.optional(v.string()),
							agentVersion: v.optional(v.string()),
						}),
						v.object({
							backend: backendSchema,
							ok: v.literal(false),
							message: v.string(),
						}),
					]),
				),
				Effect.fn(function* (opt) {
					return yield* harnesses.check(opt.input.backend);
				}),
			),
			authStatus: yield* createHandler(
				os
					.input(v.object({ backend: backendSchema }))
					.output(harnessAuthStatusOutput),
				Effect.fn(function* (opt) {
					return yield* harnesses.authStatus(opt.input.backend);
				}),
			),
			login: yield* createHandler(
				os
					.input(v.object({ backend: backendSchema }))
					.output(harnessLoginOutput),
				Effect.fn(function* (opt) {
					return yield* harnesses.login(opt.input.backend);
				}),
			),
			cancelLogin: yield* createHandler(
				os
					.input(v.object({ backend: backendSchema }))
					.output(v.object({ backend: backendSchema, cancelled: v.boolean() })),
				Effect.fn(function* (opt) {
					return yield* harnesses.cancelLogin(opt.input.backend);
				}),
			),
			logout: yield* createHandler(
				os
					.input(v.object({ backend: backendSchema }))
					.output(harnessAuthStatusOutput),
				Effect.fn(function* (opt) {
					const status = yield* harnesses.logout(opt.input.backend);
					return status;
				}),
			),
		},
		models: {
			list: yield* createHandler(
				os
					.input(
						v.object({
							backend: backendSchema,
						}),
					)
					.output(
						v.array(
							v.object({ id: v.string(), label: v.optional(v.string()) }),
						),
					),
				Effect.fn(function* (opt) {
					const models = yield* modelCatalog.list(opt.input.backend);
					return models.map((entry) => ({ id: entry.id, label: entry.label }));
				}),
			),
			efforts: yield* createHandler(
				os
					.input(
						v.object({
							backend: backendSchema,
							model_id: v.pipe(v.string(), v.nonEmpty()),
						}),
					)
					.output(v.array(v.object({ value: v.string(), label: v.string() }))),
				Effect.fn(function* (opt) {
					const efforts = yield* modelCatalog.listEfforts(
						opt.input.backend,
						opt.input.model_id,
					);
					return [...efforts];
				}),
			),
		},
	};
});

export type EngineRouter = Effect.Success<typeof program>;
export { program };
