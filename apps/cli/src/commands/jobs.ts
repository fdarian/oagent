import { Args, Command, Options } from '@effect/cli';
import { Effect } from 'effect';
import {
	createEngineClient,
	defaultEngineUrl,
	type EngineClient,
} from '#/lib/engine-client.ts';
import type { Version } from '#/lib/misc.ts';

type WaitResult = Awaited<ReturnType<EngineClient['jobs']['wait']>>;

/** Per-request wait budget. The engine's wait blocks up to this long before returning. */
const CHUNK_MS = 600_000;
/** Overall wait budget default: 3 hours — a safe upper bound; most agent jobs run 30s–1hr. */
const DEFAULT_TIMEOUT_MS = 10_800_000;

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Polls the engine's `jobs.wait` in CHUNK_MS slices until the job reaches a terminal
 * state or the overall deadline passes. A single long-lived HTTP request would be
 * fragile, so we re-issue short waits and re-poll while the job is still running.
 */
async function pollWait(
	client: EngineClient,
	jobId: string,
	timeoutMs: number,
): Promise<WaitResult> {
	const deadline = Date.now() + timeoutMs;

	for (;;) {
		const remaining = deadline - Date.now();
		const result = await client.jobs.wait({
			jobId,
			timeoutMs: Math.min(CHUNK_MS, remaining),
		});

		if (result.status !== 'running') {
			return result;
		}
		if (Date.now() >= deadline) {
			return result;
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

	return Command.make('jobs').pipe(
		Command.withDescription('Inspect and wait on oagent jobs'),
		Command.withSubcommands([wait]),
	);
};
