export type SessionLastActivity = '1d' | '3d' | '7d' | '30d' | 'all';

export const SESSION_LAST_ACTIVITY_OPTIONS: {
	value: SessionLastActivity;
	label: string;
}[] = [
	{ value: '1d', label: '1d' },
	{ value: '3d', label: '3d' },
	{ value: '7d', label: '7d' },
	{ value: '30d', label: '30d' },
	{ value: 'all', label: 'All' },
];

const DAY_MS = 86_400_000;

const WINDOW_DAYS = {
	'1d': 1,
	'3d': 3,
	'7d': 7,
	'30d': 30,
} as const;

export function isSessionLastActivity(
	value: string,
): value is SessionLastActivity {
	return SESSION_LAST_ACTIVITY_OPTIONS.some((option) => option.value === value);
}

export function filterSessionsByLastActivity<
	T extends { lastActivityAt: number },
>(sessions: T[], lastActivity: SessionLastActivity, now: number): T[] {
	if (lastActivity === 'all') return sessions;
	const cutoff = now - WINDOW_DAYS[lastActivity] * DAY_MS;
	return sessions.filter((session) => session.lastActivityAt >= cutoff);
}
