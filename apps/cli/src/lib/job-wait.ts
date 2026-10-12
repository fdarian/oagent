import type { EngineClient } from './engine-client.ts';

export type WaitResult = Awaited<ReturnType<EngineClient['jobs']['wait']>>;

/** Per-request wait budget. The engine's wait blocks up to this long before returning. */
const CHUNK_MS = 600_000;

/** Transport-retry backoff starting delay (ms). */
const RETRY_BACKOFF_BASE_MS = 1_000;
/** Transport-retry backoff ceiling (ms). */
const RETRY_BACKOFF_CAP_MS = 15_000;
/** How long a continuous failure streak must last before we give up (ms). */
const RETRY_GIVE_UP_MS = 120_000;

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
export async function pollWait(
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
