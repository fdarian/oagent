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
