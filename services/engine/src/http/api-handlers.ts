import { HttpApiBuilder } from '@effect/platform';
import { Effect } from 'effect';
import { Jobs } from '../jobs.ts';
import { ModelCatalog } from '../model-catalog.ts';
import { EngineApi, ModelResolutionError } from './api.ts';

export const jobsGroupLayer = HttpApiBuilder.group(
	EngineApi,
	'jobs',
	(handlers) =>
		handlers
			.handle('list', () =>
				Effect.gen(function* () {
					const jobs = yield* Jobs;
					return jobs.list();
				}),
			)
			.handle('get', (ctx) =>
				Effect.gen(function* () {
					const jobs = yield* Jobs;
					const detail = jobs.getDetail(ctx.path.jobId);
					if (detail === undefined) {
						return null;
					}
					return {
						id: detail.id,
						status: detail.status,
						createdAt: detail.createdAt,
						terminatedAt: detail.terminatedAt,
						prompt: detail.prompt,
						cwd: detail.cwd,
						model: detail.model,
					};
				}),
			)
			.handle('start', (ctx) =>
				Effect.gen(function* () {
					const jobs = yield* Jobs;
					return yield* jobs
						.start(ctx.payload)
						.pipe(
							Effect.catchTag('ModelResolutionError', (err) =>
								Effect.fail(new ModelResolutionError({ message: err.message })),
							),
						);
				}),
			)
			.handle('cancel', (ctx) =>
				Effect.gen(function* () {
					const jobs = yield* Jobs;
					return yield* jobs.cancel({ jobId: ctx.path.jobId }).pipe(
						Effect.as({ ok: true }),
						Effect.catchTag('JobNotFound', () => Effect.succeed({ ok: false })),
					);
				}),
			)
			.handle('wait', (ctx) =>
				Effect.gen(function* () {
					const jobs = yield* Jobs;
					return yield* jobs
						.wait({
							jobId: ctx.path.jobId,
							timeoutMs: ctx.urlParams.timeoutMs,
						})
						.pipe(
							Effect.catchTag('JobNotFound', (err) =>
								Effect.succeed({
									status: 'error' as const,
									message: `Job not found: ${err.jobId}`,
								}),
							),
						);
				}),
			),
);

export const aliasesGroupLayer = HttpApiBuilder.group(
	EngineApi,
	'aliases',
	(handlers) =>
		handlers
			.handle('list', () =>
				Effect.gen(function* () {
					const jobs = yield* Jobs;
					return jobs.listAliases().map((row) => ({
						name: row.name,
						backend: row.backend,
						model_id: row.model_id,
						description: row.description ?? undefined,
					}));
				}),
			)
			.handle('save', (ctx) =>
				Effect.gen(function* () {
					const jobs = yield* Jobs;
					return jobs.saveAlias({
						name: ctx.payload.name,
						backend: ctx.payload.backend,
						model_id: ctx.payload.model_id,
						description: ctx.payload.description,
					});
				}),
			)
			.handle('delete', (ctx) =>
				Effect.gen(function* () {
					const jobs = yield* Jobs;
					return { ok: jobs.deleteAlias(ctx.path.name) };
				}),
			),
);

export const modelsGroupLayer = HttpApiBuilder.group(
	EngineApi,
	'models',
	(handlers) =>
		handlers.handle('list', (ctx) =>
			Effect.gen(function* () {
				const modelCatalog = yield* ModelCatalog;
				const models = yield* modelCatalog.list(ctx.path.backend);
				return models.map((entry) => ({
					id: entry.id,
					label: entry.label,
				}));
			}),
		),
);
