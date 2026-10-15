import { groupByDay } from './format.ts';

export type SessionGroupBy = 'date' | 'state' | 'none';

export type SessionGroup<T> = { label: string | null; items: T[] };

export const SESSION_GROUP_BY_OPTIONS: {
	value: SessionGroupBy;
	label: string;
}[] = [
	{ value: 'date', label: 'Date' },
	{ value: 'state', label: 'State' },
	{ value: 'none', label: 'None' },
];

const STATE_GROUPS = [
	{ status: 'running', label: 'RUNNING' },
	{ status: 'error', label: 'FAILED' },
	{ status: 'cancelled', label: 'CANCELLED' },
	{ status: 'done', label: 'DONE' },
];

export function isSessionGroupBy(value: string): value is SessionGroupBy {
	return value === 'date' || value === 'state' || value === 'none';
}

function groupByState<T extends { status: string }>(
	items: T[],
): SessionGroup<T>[] {
	for (const item of items) {
		if (!STATE_GROUPS.some((group) => group.status === item.status)) {
			throw new Error(`Unknown session status: ${item.status}`);
		}
	}
	return STATE_GROUPS.map((group) => ({
		label: group.label,
		items: items.filter((item) => item.status === group.status),
	})).filter((group) => group.items.length > 0);
}

export function groupSessions<
	T extends { status: string; lastActivityAt: number },
>(sessions: T[], groupBy: SessionGroupBy): SessionGroup<T>[] {
	if (groupBy === 'date') return groupByDay(sessions);
	if (groupBy === 'state') return groupByState(sessions);
	if (sessions.length === 0) return [];
	return [{ label: null, items: sessions }];
}
