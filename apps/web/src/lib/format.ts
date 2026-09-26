export function formatAge(ms: number): string {
	const secs = Math.floor((Date.now() - ms) / 1000);
	if (secs < 60) return `${secs}s ago`;
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	return `${days}d ago`;
}

export function formatElapsed(startMs: number, endMs?: number): string {
	const delta = Math.floor(((endMs ?? Date.now()) - startMs) / 1000);
	if (delta < 60) return `${delta}s`;
	const mins = Math.floor(delta / 60);
	const secs = delta % 60;
	if (mins < 60) return `${mins}m ${secs}s`;
	const hrs = Math.floor(mins / 60);
	const remainingMins = mins % 60;
	return `${hrs}h ${remainingMins}m`;
}

function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

function isYesterday(d: Date, now: Date): boolean {
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	return isSameDay(d, yesterday);
}

function formatMonthDay(d: Date): string {
	return d
		.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
		.toUpperCase();
}

export function groupByDay<T extends { createdAt: number }>(
	items: T[],
): { label: string; items: T[] }[] {
	const now = new Date();
	const groups = new Map<string, T[]>();

	for (const item of items) {
		const d = new Date(item.createdAt);
		let label: string;
		if (isSameDay(d, now)) {
			label = 'TODAY';
		} else if (isYesterday(d, now)) {
			label = 'YESTERDAY';
		} else {
			label = formatMonthDay(d);
		}
		const list = groups.get(label);
		if (list === undefined) {
			groups.set(label, [item]);
		} else {
			list.push(item);
		}
	}

	return Array.from(groups.entries()).map(([label, items]) => ({
		label,
		items,
	}));
}
