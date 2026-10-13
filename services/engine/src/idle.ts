import { Duration, Effect } from 'effect';

export function parseIdleDuration(value: string) {
	return Effect.try(() => {
		const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value);
		const units: Record<string, string> = {
			ms: 'millis',
			s: 'seconds',
			m: 'minutes',
			h: 'hours',
			d: 'days',
		};
		const input =
			match === null ? value : `${match[1]} ${units[String(match[2])]}`;
		return Duration.fromInputUnsafe(input as Duration.Input);
	}).pipe(
		Effect.flatMap((duration) =>
			Number.isFinite(Duration.toMillis(duration)) &&
			Duration.toMillis(duration) > 0
				? Effect.succeed(duration)
				: Effect.fail(
						new Error('idle-exit must be a positive finite duration'),
					),
		),
	);
}

export function createIdleTracker(now = Date.now) {
	let lastActivity = now();
	let requests = 0;
	let sticky = false;
	return {
		enter(path: string) {
			lastActivity = now();
			requests++;
			if (path === '/mcp') sticky = true;
			let finished = false;
			return () => {
				if (finished) return;
				finished = true;
				requests--;
				lastActivity = now();
			};
		},
		shouldExit(durationMs: number, running: boolean) {
			return (
				!sticky &&
				requests === 0 &&
				!running &&
				now() - lastActivity >= durationMs
			);
		},
	};
}

/** Calls `finish` once the response body is fully read, errors or is cancelled. */
export function trackResponseBody(response: Response, finish: () => void) {
	if (response.body === null) {
		finish();
		return response;
	}
	// Bun derives Content-Type of Bun.file bodies lazily and drops it once the
	// body is locked by getReader(), so snapshot the headers first.
	const headers = new Headers(response.headers);
	const reader = response.body.getReader();
	return new Response(
		new ReadableStream({
			async pull(controller) {
				try {
					const chunk = await reader.read();
					if (chunk.done) {
						finish();
						controller.close();
					} else controller.enqueue(chunk.value);
				} catch (cause) {
					finish();
					controller.error(cause);
				}
			},
			async cancel(reason) {
				finish();
				await reader.cancel(reason);
			},
		}),
		{ status: response.status, statusText: response.statusText, headers },
	);
}
