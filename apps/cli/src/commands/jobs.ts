import { formatToolError, formatTurnResult } from '@oagent/engine';
import { encode } from '@toon-format/toon';
import { Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import {
	createEngineClient,
	defaultEngineUrl,
	type EngineClient,
} from '#/lib/engine-client.ts';
import type { Version } from '#/lib/misc.ts';

type WaitResult = Awaited<ReturnType<EngineClient['jobs']['wait']>>;
type ListResult = Awaited<ReturnType<EngineClient['jobs']['list']>>;
type ListJob = ListResult[number];

/** Per-request wait budget. The engine's wait blocks up to this long before returning. */
const CHUNK_MS = 600_000;

/** Transport-retry backoff starting delay (ms). */
const RETRY_BACKOFF_BASE_MS = 1_000;
/** Transport-retry backoff ceiling (ms). */
const RETRY_BACKOFF_CAP_MS = 15_000;
/** How long a continuous failure streak must last before we give up (ms). */
const RETRY_GIVE_UP_MS = 120_000;

/** Unwraps nested `.cause` chains to surface the deepest meaningful error message. */
function errorMessage(cause: unknown): string {
	if (!(cause instanceof Error)) {
		return String(cause);
	}
	if (cause.cause !== undefined) {
		return errorMessage(cause.cause);
	}
	return cause.message;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls the engine's `jobs.wait` in CHUNK_MS slices until the job reaches a terminal
 * state. A single long-lived HTTP request would be
 * fragile, so we re-issue short waits and re-poll while the job is still running.
 *
 * Transport-level rejections (connection refused, reset, fetch failure) are retried
 * with exponential backoff rather than propagating immediately — the engine may be
 * restarting. oRPC logical errors (job failed, job-not-found) arrive as successful
 * responses shaped `{status: 'error', ...}` and are NOT retried (handled by the
 * `result.status !== 'running'` branch below). A continuous failure streak beyond
 * RETRY_GIVE_UP_MS re-throws so a permanently-dead engine surfaces quickly.
 *
 * TODO: when this module migrates to Effect HTTP, replace the catch-rejection
 * mechanism here with typed/validated fetch errors from the Effect HTTP client.
 */
async function pollWait(
	client: EngineClient,
	jobId: string,
): Promise<WaitResult> {
	let streakStartMs: number | null = null;
	let backoffMs = RETRY_BACKOFF_BASE_MS;

	for (;;) {
		try {
			const result = await client.jobs.wait({
				jobId,
				timeoutMs: CHUNK_MS,
			});

			// Successful response: reset failure-streak state.
			streakStartMs = null;
			backoffMs = RETRY_BACKOFF_BASE_MS;

			if (result.status !== 'running') {
				return result;
			}
		} catch (caught) {
			const now = Date.now();

			if (streakStartMs === null) {
				streakStartMs = now;
			}

			if (now - streakStartMs >= RETRY_GIVE_UP_MS) {
				throw new Error(
					`Engine unreachable for ${RETRY_GIVE_UP_MS / 1000}s continuously (jobId: ${jobId})`,
					{ cause: caught },
				);
			}

			await sleep(backoffMs);
			backoffMs = Math.min(backoffMs * 2, RETRY_BACKOFF_CAP_MS);
		}
	}
}

function runWait(params: { jobId: string; engineUrl: string; json: boolean }) {
	return Effect.tryPromise(async () => {
		const client = createEngineClient(params.engineUrl);
		const job = await client.jobs.get({ jobId: params.jobId });
		if (job === undefined) throw new Error(`Job not found: ${params.jobId}`);
		const result = await pollWait(client, params.jobId);
		const output = params.json
			? JSON.stringify(result)
			: formatTurnResult({
					sessionId: job.sessionId,
					jobId: params.jobId,
					result,
					worktreePath: job.worktreePath,
					worktreeBranch: job.worktreeBranch,
				});
		process.stdout.write(`${output}\n`);
	}).pipe(
		Effect.catch((cause) =>
			Effect.sync(() => {
				const message = errorMessage(cause).includes('Job not found')
					? `Job not found: ${params.jobId}`
					: errorMessage(cause);
				const output = params.json
					? JSON.stringify({ status: 'error', message })
					: formatToolError(message);
				process.stderr.write(`${output}\n`);
				process.exitCode = 1;
			}),
		),
	);
}

function renderToon(
	total: number,
	shown: number,
	jobs: ReadonlyArray<ListJob>,
) {
	const mapped = jobs.map((job) => ({
		status: job.status,
		id: job.id,
		created: new Date(job.createdAt).toISOString(),
		model: job.model ?? null,
		cwd: job.cwd,
		prompt:
			job.prompt.replace(/\n/g, ' ').length > 120
				? `${job.prompt.replace(/\n/g, ' ').slice(0, 120)}…`
				: job.prompt.replace(/\n/g, ' '),
	}));
	return `${encode({ total, shown, jobs: mapped })}\n`;
}

function renderJson(
	total: number,
	shown: number,
	jobs: ReadonlyArray<ListJob>,
) {
	const mapped = jobs.map((job) => ({
		id: job.id,
		status: job.status,
		createdAt: new Date(job.createdAt).toISOString(),
		terminatedAt:
			job.terminatedAt !== undefined
				? new Date(job.terminatedAt).toISOString()
				: undefined,
		prompt: job.prompt,
		cwd: job.cwd,
		model: job.model,
	}));
	return `${JSON.stringify({ total, shown, jobs: mapped })}\n`;
}

function runList(params: {
	engineUrl: string;
	limit: number;
	format: 'toon' | 'json';
}) {
	return Effect.tryPromise(async () => {
		const client = createEngineClient(params.engineUrl);
		const fullList = await client.jobs.list();
		const sliced = fullList.slice(0, params.limit);
		const total = fullList.length;
		const shown = sliced.length;

		const output =
			params.format === 'json'
				? renderJson(total, shown, sliced)
				: renderToon(total, shown, sliced);

		process.stdout.write(output);
	}).pipe(
		Effect.catch((cause) =>
			Effect.sync(() => {
				const message = errorMessage(cause);
				process.stderr.write(
					`${JSON.stringify({ status: 'error', message })}\n`,
				);
				process.exitCode = 1;
			}),
		),
	);
}

export const jobsCmd = (_version: Version) => {
	const wait = Command.make(
		'wait',
		{
			jobId: Argument.String('jobId'),
			engineUrl: Flag.String('engine-url').pipe(
				Flag.withDefault(defaultEngineUrl),
				Flag.withDescription(
					'Base URL of the running oagent engine (default: http://localhost:17777 or $OPENCODE_MCP_PORT).',
				),
			),
			json: Flag.Boolean('json').pipe(
				Flag.withDefault(false),
				Flag.withDescription(
					'Print the current JSON result instead of markdown.',
				),
			),
		},
		(options) =>
			runWait({
				jobId: options.jobId,
				engineUrl: options.engineUrl,
				json: options.json,
			}),
	).pipe(
		Command.withDescription(
			'Wait for a job to reach a terminal state, polling the engine directly, and print its result as markdown (or JSON with --json).',
		),
	);

	const list = Command.make(
		'list',
		{
			engineUrl: Flag.String('engine-url').pipe(
				Flag.withDefault(defaultEngineUrl),
				Flag.withDescription(
					'Base URL of the running oagent engine (default: http://localhost:17777 or $OPENCODE_MCP_PORT).',
				),
			),
			limit: Flag.Int('limit').pipe(
				Flag.withDefault(10),
				Flag.withDescription(
					'Maximum number of jobs to show (default: 10). Raise to see more, e.g. --limit 50.',
				),
			),
			format: Flag.Literals('format', ['toon', 'json']).pipe(
				Flag.withDefault('toon'),
				Flag.withDescription(
					'Output format. toon (default) is the compact, token-efficient format for agent/LLM consumption; json is full-fidelity for piping.',
				),
			),
		},
		({ engineUrl, limit, format }) => runList({ engineUrl, limit, format }),
	).pipe(
		Command.withDescription(
			'List recent jobs (running first, then newest first). Useful for recovering a jobId after an interrupted wait.',
		),
	);

	return Command.make('jobs').pipe(
		Command.withDescription('Inspect and wait on oagent jobs'),
		Command.withSubcommands([wait, list]),
	);
};
