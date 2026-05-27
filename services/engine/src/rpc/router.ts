import { os } from '@orpc/server';
import { Effect } from 'effect';
import { createHandler } from 'ff-effect/for/orpc';
import * as v from 'valibot';
import { Jobs, ModelNotAvailableError } from '../jobs.ts';
import { ModelCatalog } from '../model-catalog.ts';

const program = Effect.gen(function* () {
	const jobs = yield* Jobs;
	const modelCatalog = yield* ModelCatalog;

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
							model: v.optional(v.string()),
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
							model: v.optional(v.string()),
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
						model: detail.model,
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
							v.object({ status: v.literal('error'), message: v.string() }),
							v.object({ status: v.literal('cancelled') }),
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
							backend: v.picklist(['opencode', 'cursor']),
							model_id: v.pipe(v.string(), v.nonEmpty()),
							description: v.optional(v.string()),
						}),
					)
					.output(
						v.union([
							v.object({
								ok: v.literal(true),
								name: v.string(),
								backend: v.string(),
								model_id: v.string(),
								description: v.optional(v.string()),
							}),
							v.object({
								ok: v.literal(false),
								error: v.object({ code: v.string(), message: v.string() }),
							}),
						]),
					),
				Effect.fn(function* (opt) {
					return yield* Effect.gen(function* () {
						const models = yield* modelCatalog.list(opt.input.backend);
						if (!models.includes(opt.input.model_id)) {
							return yield* new ModelNotAvailableError({
								model_id: opt.input.model_id,
								backend: opt.input.backend,
								known_count: models.length,
								message: `model '${opt.input.model_id}' not available for ${opt.input.backend} (${models.length} known) — pick from the combobox or refresh`,
							});
						}
						const saved = jobs.saveAlias({
							name: opt.input.name,
							backend: opt.input.backend,
							model_id: opt.input.model_id,
							description: opt.input.description,
						});
						return {
							ok: true as const,
							name: saved.name,
							backend: saved.backend,
							model_id: saved.model_id,
							description: saved.description,
						};
					}).pipe(
						Effect.catchTag('ModelNotAvailableError', (err) =>
							Effect.succeed({
								ok: false as const,
								error: {
									code: 'MODEL_NOT_AVAILABLE',
									message: err.message,
								},
							}),
						),
						Effect.catchTag('ModelCatalogError', (err) =>
							Effect.succeed({
								ok: false as const,
								error: {
									code: 'MODEL_CATALOG_UNAVAILABLE',
									message: err.message,
								},
							}),
						),
					);
				}),
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
		models: {
			list: yield* createHandler(
				os
					.input(v.object({ backend: v.picklist(['opencode', 'cursor']) }))
					.output(v.array(v.string())),
				Effect.fn(function* (opt) {
					const models = yield* modelCatalog.list(opt.input.backend);
					return [...models];
				}),
			),
		},
	};
});

export type EngineRouter = Effect.Effect.Success<typeof program>;
export { program };
