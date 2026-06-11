import { Args, Command, Options } from '@effect/cli';
import { encode } from '@toon-format/toon';
import { Effect } from 'effect';
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
/** Overall wait budget default: 3 hours — a safe upper bound; most agent jobs run 30s–1hr. */
const DEFAULT_TIMEOUT_MS = 10_800_000;

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
 * state or the overall deadline passes. A single long-lived HTTP request would be
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
	timeoutMs: number,
): Promise<WaitResult> {
	const deadline = Date.now() + timeoutMs;

	let streakStartMs: number | null = null;
	let backoffMs = RETRY_BACKOFF_BASE_MS;

	for (;;) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			// Deadline passed during a failure streak — surface as timeout.
			throw new Error(
				`Transport failures persisted until the overall deadline (jobId: ${jobId})`,
			);
		}

		try {
			const result = await client.jobs.wait({
				jobId,
				timeoutMs: Math.min(CHUNK_MS, remaining),
			});

			// Successful response: reset failure-streak state.
			streakStartMs = null;
			backoffMs = RETRY_BACKOFF_BASE_MS;

			if (result.status !== 'running') {
				return result;
			}
			if (Date.now() >= deadline) {
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

			const deadlineRemaining = deadline - now;
			if (deadlineRemaining <= 0) {
				throw new Error(
					`Transport failures persisted until the overall deadline (jobId: ${jobId})`,
					{ cause: caught },
				);
			}

			await sleep(Math.min(backoffMs, deadlineRemaining));
			backoffMs = Math.min(backoffMs * 2, RETRY_BACKOFF_CAP_MS);
		}
	}
}

function runWait(params: {
	jobId: string;
	engineUrl: string;
	timeoutMs: number;
}) {
	return Effect.tryPromise(async () => {
		const client = createEngineClient(params.engineUrl);
		const result = await pollWait(client, params.jobId, params.timeoutMs);
		process.stdout.write(`${JSON.stringify(result)}\n`);
	}).pipe(
		Effect.catchAll((cause) =>
			Effect.sync(() => {
				const message = errorMessage(cause).includes('Job not found')
					? `Job not found: ${params.jobId}`
					: errorMessage(cause);
				process.stderr.write(
					`${JSON.stringify({ status: 'error', message })}\n`,
				);
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
		Effect.catchAll((cause) =>
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
			jobId: Args.text({ name: 'jobId' }),
			engineUrl: Options.text('engine-url').pipe(
				Options.withDefault(defaultEngineUrl),
				Options.withDescription(
					'Base URL of the running oagent engine (default: http://localhost:17777 or $OPENCODE_MCP_PORT).',
				),
			),
			timeoutMs: Options.integer('timeout-ms').pipe(
				Options.withDefault(DEFAULT_TIMEOUT_MS),
				Options.withDescription(
					'Overall wait budget in ms before giving up and returning {status:"running"} (default: 10800000 = 3h; a safe upper bound, most agent jobs run 30s–1hr).',
				),
			),
		},
		({ jobId, engineUrl, timeoutMs }) =>
			runWait({ jobId, engineUrl, timeoutMs }),
	).pipe(
		Command.withDescription(
			'Wait for a job to reach a terminal state, polling the engine directly, and print the result JSON to stdout.',
		),
	);

	const list = Command.make(
		'list',
		{
			engineUrl: Options.text('engine-url').pipe(
				Options.withDefault(defaultEngineUrl),
				Options.withDescription(
					'Base URL of the running oagent engine (default: http://localhost:17777 or $OPENCODE_MCP_PORT).',
				),
			),
			limit: Options.integer('limit').pipe(
				Options.withDefault(10),
				Options.withDescription(
					'Maximum number of jobs to show (default: 10). Raise to see more, e.g. --limit 50.',
				),
			),
			format: Options.choice('format', ['toon', 'json']).pipe(
				Options.withDefault('toon'),
				Options.withDescription(
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
