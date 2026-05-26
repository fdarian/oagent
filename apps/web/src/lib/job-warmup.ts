const warmedAt = new Map<string, number>();
const active = new Set<string>();
const WARMUP_COOLDOWN_MS = 5000;
const MAX_CONCURRENT = 2;
const WARMUP_TIMEOUT_MS = 5000;

export function warmUpJobEvents(
	jobId: string,
	selectedId: string | undefined,
): void {
	if (jobId === selectedId) return;

	const last = warmedAt.get(jobId);
	if (last !== undefined && Date.now() - last < WARMUP_COOLDOWN_MS) return;

	if (active.size >= MAX_CONCURRENT) return;

	warmedAt.set(jobId, Date.now());
	active.add(jobId);

	const source = new EventSource(`/jobs/${jobId}/events`);
	let done = false;

	const cleanup = (): void => {
		if (done) return;
		done = true;
		source.close();
		active.delete(jobId);
	};

	source.onmessage = () => {
		cleanup();
	};

	source.onerror = () => {
		cleanup();
	};

	setTimeout(cleanup, WARMUP_TIMEOUT_MS);
}
