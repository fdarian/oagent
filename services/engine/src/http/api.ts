import {
	HttpApi,
	HttpApiEndpoint,
	HttpApiGroup,
} from '@effect/platform';
import * as HttpApiSchema from '@effect/platform/HttpApiSchema';
import * as Schema from 'effect/Schema';
import { ModelCatalogError } from '../model-catalog.ts';

const Backend = Schema.Literal('opencode', 'cursor', 'grok');
const JobStatus = Schema.Literal('running', 'done', 'error', 'cancelled');
const JobSummary = Schema.Struct({
	id: Schema.String,
	status: JobStatus,
	createdAt: Schema.Number,
	terminatedAt: Schema.optional(Schema.Number),
	prompt: Schema.String,
	cwd: Schema.String,
	model: Schema.optional(Schema.String),
});
const Alias = Schema.Struct({
	name: Schema.String,
	backend: Schema.String,
	model_id: Schema.String,
	description: Schema.optional(Schema.String),
});

export class ModelResolutionError extends Schema.TaggedError<ModelResolutionError>()(
	'ModelResolutionError',
	{ message: Schema.String },
	HttpApiSchema.annotations({ status: 422 }),
) {}

const JobWaitResult = Schema.Union(
	Schema.Struct({ status: Schema.Literal('running') }),
	Schema.Struct({
		status: Schema.Literal('done'),
		sessionId: Schema.String,
		text: Schema.String,
		stopReason: Schema.optional(Schema.String),
	}),
	Schema.Struct({ status: Schema.Literal('error'), message: Schema.String }),
	Schema.Struct({ status: Schema.Literal('cancelled') }),
);

const AliasSavePayload = Schema.Struct({
	name: Schema.String.pipe(
		Schema.nonEmptyString(),
		Schema.pattern(/^[a-z0-9-]+$/),
	),
	backend: Backend,
	model_id: Schema.String.pipe(Schema.nonEmptyString()),
	description: Schema.optional(Schema.String),
});

const ModelEntry = Schema.Struct({
	id: Schema.String,
	label: Schema.optional(Schema.String),
});

const jobsList = HttpApiEndpoint.get('list', '/jobs').addSuccess(
	Schema.Array(JobSummary),
);
const jobsGet = HttpApiEndpoint.get('get', '/jobs/:jobId')
	.setPath(Schema.Struct({ jobId: Schema.String }))
	.addSuccess(Schema.NullOr(JobSummary));
const jobsStart = HttpApiEndpoint.post('start', '/jobs')
	.setPayload(
		Schema.Struct({
			prompt: Schema.String,
			cwd: Schema.String,
			model: Schema.optional(Schema.String),
			sessionId: Schema.optional(Schema.String),
		}),
	)
	.addSuccess(Schema.Struct({ jobId: Schema.String }))
	.addError(ModelResolutionError);
const jobsCancel = HttpApiEndpoint.post('cancel', '/jobs/:jobId/cancel')
	.setPath(Schema.Struct({ jobId: Schema.String }))
	.addSuccess(Schema.Struct({ ok: Schema.Boolean }));
const jobsWait = HttpApiEndpoint.get('wait', '/jobs/:jobId/wait')
	.setPath(Schema.Struct({ jobId: Schema.String }))
	.setUrlParams(
		Schema.Struct({
			timeoutMs: Schema.optional(Schema.NumberFromString),
		}),
	)
	.addSuccess(JobWaitResult);

const jobsGroup = HttpApiGroup.make('jobs')
	.add(jobsList)
	.add(jobsGet)
	.add(jobsStart)
	.add(jobsCancel)
	.add(jobsWait);

const aliasesList = HttpApiEndpoint.get('list', '/aliases').addSuccess(
	Schema.Array(Alias),
);
const aliasesSave = HttpApiEndpoint.post('save', '/aliases')
	.setPayload(AliasSavePayload)
	.addSuccess(Alias);
const aliasesDelete = HttpApiEndpoint.del('delete', '/aliases/:name')
	.setPath(Schema.Struct({ name: Schema.String }))
	.addSuccess(Schema.Struct({ ok: Schema.Boolean }));

const aliasesGroup = HttpApiGroup.make('aliases')
	.add(aliasesList)
	.add(aliasesSave)
	.add(aliasesDelete);

const modelsList = HttpApiEndpoint.get('list', '/models/:backend')
	.setPath(Schema.Struct({ backend: Backend }))
	.addSuccess(Schema.Array(ModelEntry))
	.addError(ModelCatalogError);

const modelsGroup = HttpApiGroup.make('models').add(modelsList);

export const EngineApi = HttpApi.make('engine')
	.add(jobsGroup)
	.add(aliasesGroup)
	.add(modelsGroup)
	.prefix('/rpc');

export type EngineApiType = typeof EngineApi;