/** Terminal job outcome from engine `jobs.wait` (post-sentinel fetch). */
export type JobWaitResult =
	| { readonly status: 'running' }
	| {
			readonly status: 'done';
			readonly sessionId: string;
			readonly text: string;
			readonly stopReason?: string;
	  }
	| { readonly status: 'error'; readonly message: string }
	| { readonly status: 'cancelled' };

/** Short timeout for the single post-terminal jobs.wait fetch (job is already terminal). */
export const TERMINAL_FETCH_TIMEOUT_MS = 5_000;

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export function channelEventFor(jobId: string, result: JobWaitResult) {
	if (result.status === 'done') {
		const meta: Record<string, string> = {
			job_id: jobId,
			status: 'done',
			session_id: result.sessionId,
		};
		if (result.stopReason !== undefined) {
			meta.stop_reason = result.stopReason;
		}
		return { content: result.text, meta };
	}
	if (result.status === 'error') {
		return {
			content: `Agent job failed: ${result.message}`,
			meta: { job_id: jobId, status: 'error' },
		};
	}
	return {
		content: 'Agent job was cancelled.',
		meta: { job_id: jobId, status: 'cancelled' },
	};
}

export type ChannelNotify = (
	content: string,
	meta: Record<string, string>,
) => Promise<void>;

export type FetchSse = (
	url: URL,
	signal: AbortSignal,
) => Promise<ReadableStream<Uint8Array> | null>;

const defaultFetchSse: FetchSse = async (url, signal) => {
	const res = await fetch(url, { signal });
	return res.body;
};

/**
 * Listens to the engine's SSE event stream for the job until the terminal sentinel
 * arrives, fetches the final result once, and notifies with the channel payload.
 */
export async function waitForTerminalAndNotify(params: {
	jobId: string;
	engineUrl: string;
	fetchSse?: FetchSse;
	waitJob: (args: {
		jobId: string;
		timeoutMs: number;
	}) => Promise<JobWaitResult>;
	notify: ChannelNotify;
}): Promise<void> {
	const {
		jobId,
		engineUrl,
		fetchSse = defaultFetchSse,
		waitJob,
		notify,
	} = params;
	const ac = new AbortController();
	try {
		for (;;) {
			const sseUrl = new URL(`/jobs/${jobId}/events`, engineUrl);
			const body = await fetchSse(sseUrl, ac.signal);
			if (!body) {
				throw new Error('SSE stream has no body');
			}

			const reader = body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let gotTerminal = false;

			while (!gotTerminal) {
				const chunk = await reader.read();
				if (chunk.done) break;

				buffer += decoder.decode(chunk.value, { stream: true });
				const frames = buffer.split('\n\n');
				const tail = frames.pop();
				buffer = tail === undefined ? '' : tail;

				for (const frame of frames) {
					const lines = frame.split('\n');
					let payload: string | undefined;
					for (const line of lines) {
						if (line.startsWith('data:')) {
							payload = line.slice('data:'.length).trim();
							break;
						}
					}
					if (payload === undefined) continue;
					if (payload === '"__terminal__"') {
						gotTerminal = true;
						break;
					}
				}
			}

			await reader.cancel().catch(() => {});

			if (gotTerminal) {
				const result = await waitJob({
					jobId,
					timeoutMs: TERMINAL_FETCH_TIMEOUT_MS,
				});
				const event = channelEventFor(jobId, result);
				await notify(event.content, event.meta);
				return;
			}
			// Stream ended without terminal sentinel; reconnect and resume listening.
		}
	} catch (cause) {
		ac.abort();
		await notify(
			`Agent job ${jobId} failed while awaiting its result: ${errorMessage(cause)}`,
			{ job_id: jobId, status: 'error' },
		).catch(() => {});
	}
}
