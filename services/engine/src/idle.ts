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
