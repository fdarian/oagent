import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { orpc } from './orpc.ts';
import {
	groupSessions,
	isSessionGroupBy,
	type SessionGroupBy,
} from './session-grouping.ts';
import {
	filterSessionsByLastActivity,
	isSessionLastActivity,
	type SessionLastActivity,
} from './session-last-activity.ts';
import { useSessionListStream } from './use-session-list-stream.ts';

export type SessionListItem = {
	id: string;
	jobId: string;
	title: string;
	status: string;
	createdAt: number;
	lastActivityAt: number;
	prompt: string;
	cwd: string;
};

const GROUP_BY_STORAGE_KEY = 'oagent-session-group-by';

function readStoredGroupBy(): SessionGroupBy {
	const stored = localStorage.getItem(GROUP_BY_STORAGE_KEY);
	if (stored === null) return 'date';
	if (!isSessionGroupBy(stored)) {
		throw new Error(`Invalid stored session group-by: ${stored}`);
	}
	return stored;
}

const LAST_ACTIVITY_STORAGE_KEY = 'oagent-session-last-activity';

function readStoredLastActivity(): SessionLastActivity {
	const stored = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
	if (stored === null) return '3d';
	if (!isSessionLastActivity(stored)) {
		throw new Error(`Invalid stored session last-activity: ${stored}`);
	}
	return stored;
}

export function useSessionList() {
	useSessionListStream();

	const { data, isLoading } = useQuery(
		orpc.sessions.list.queryOptions({ input: {} }),
	);

	const [cwdFilter, setCwdFilter] = useState('');
	const [groupBy, setGroupByState] =
		useState<SessionGroupBy>(readStoredGroupBy);

	const [lastActivity, setLastActivityState] = useState<SessionLastActivity>(
		readStoredLastActivity,
	);

	const setLastActivity = useCallback((next: SessionLastActivity) => {
		localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, next);
		setLastActivityState(next);
	}, []);

	const setGroupBy = useCallback((next: SessionGroupBy) => {
		localStorage.setItem(GROUP_BY_STORAGE_KEY, next);
		setGroupByState(next);
	}, []);

	const filtered = useMemo(() => {
		const recent = filterSessionsByLastActivity(
			data ?? [],
			lastActivity,
			Date.now(),
		);
		if (cwdFilter.trim() === '') return recent;
		const needle = cwdFilter.toLowerCase();
		return recent.filter((session) =>
			session.cwd.toLowerCase().includes(needle),
		);
	}, [data, cwdFilter, lastActivity]);

	const grouped = useMemo(
		() => groupSessions(filtered, groupBy),
		[filtered, groupBy],
	);

	return {
		sessions: filtered,
		grouped,
		isLoading,
		cwdFilter,
		setCwdFilter,
		lastActivity,
		setLastActivity,
		groupBy,
		setGroupBy,
	};
}
