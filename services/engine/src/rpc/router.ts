import '@orpc/experimental-effect/extensions/effect';
import '@orpc/experimental-effect/extensions/input-output';
import type { WithEffectContext } from '@orpc/experimental-effect';
import { os } from '@orpc/server';
import { Effect } from 'effect';
import * as v from 'valibot';
import { type Harness, Harnesses } from '../harnesses.ts';
import { Jobs } from '../jobs.ts';
import { ModelCatalog } from '../model-catalog.ts';
import { Settings } from '../settings.ts';

export type EngineServices = Jobs | Harnesses | Settings | ModelCatalog;
export type EngineContext = WithEffectContext<EngineServices>;

const procedure = os.$context<EngineContext>();

function normalizeReasoningEffort(value: string | null): string | undefined {
	if (value === null || value.length === 0) return undefined;
	return value;
}

const backendSchema = v.picklist(['opencode', 'cursor', 'grok', 'codex']);
const reasoningEffortSchema = v.optional(v.pipe(v.string(), v.nonEmpty()));

const toHarnessDto = (harness: Harness) => ({
	backend: harness.backend,
	binaryPath: harness.binaryPath,
	detectedAt: harness.detectedAt.getTime(),
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
				const detail = jobs.getDetail(options.input.jobId);
				if (detail === undefined) return undefined;
				return {
					id: detail.id,
					status: detail.status,
					createdAt: detail.createdAt,
					terminatedAt: detail.terminatedAt,
					prompt: detail.prompt,
					cwd: detail.cwd,
					backend: detail.backend,
					model: detail.model,
					sessionId: detail.sessionId,
				};
			}),
		start: procedure
			.input(
				v.object({
					prompt: v.string(),
					cwd: v.string(),
					model: v.optional(v.string()),
					sessionId: v.optional(v.string()),
				}),
			)
			.effect(function* (options) {
				const jobs = yield* Jobs;
				return yield* jobs.start(options.input);
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
		wait: procedure
			.input(
				v.object({
					jobId: v.string(),
					timeoutMs: v.optional(v.number()),
				}),
			)
			.effect(function* (options) {
				const jobs = yield* Jobs;
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
	aliases: {
		list: procedure.input(v.void_()).effect(function* () {
			const jobs = yield* Jobs;
			return jobs.listAliases().map(toAliasDto);
		}),
		save: procedure
			.input(
				v.object({
					name: v.pipe(v.string(), v.nonEmpty(), v.regex(/^[a-z0-9-]+$/)),
					backend: v.picklist(['opencode', 'cursor', 'grok', 'codex']),
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
	settings: {
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
				const modelCatalog = yield* ModelCatalog;
				yield* harnesses.cancelLogin('codex');
				settings.setCodexHome(options.input.home);
				yield* modelCatalog.invalidate('codex');
				return { home: settings.getCodexHome() };
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
				const modelCatalog = yield* ModelCatalog;
				const models = yield* modelCatalog.list(options.input.backend);
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
				const modelCatalog = yield* ModelCatalog;
				const efforts = yield* modelCatalog.listEfforts(
					options.input.backend,
					options.input.model_id,
				);
				return [...efforts];
			}),
	},
});

export type EngineRouter = typeof router;
export { router };
