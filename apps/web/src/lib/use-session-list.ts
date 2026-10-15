import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { orpc } from './orpc.ts';
import {
	groupSessions,
	isSessionGroupBy,
	type SessionGroupBy,
} from './session-grouping.ts';
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

export function useSessionList() {
	useSessionListStream();

	const { data, isLoading } = useQuery(
		orpc.sessions.list.queryOptions({ input: {} }),
	);

	const [cwdFilter, setCwdFilter] = useState('');
	const [groupBy, setGroupByState] =
		useState<SessionGroupBy>(readStoredGroupBy);

	const setGroupBy = useCallback((next: SessionGroupBy) => {
		localStorage.setItem(GROUP_BY_STORAGE_KEY, next);
		setGroupByState(next);
	}, []);

	const filtered = useMemo(() => {
		const sessions = data ?? [];
		if (cwdFilter.trim() === '') return sessions;
		const needle = cwdFilter.toLowerCase();
		return sessions.filter((session) =>
			session.cwd.toLowerCase().includes(needle),
		);
	}, [data, cwdFilter]);

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
		groupBy,
		setGroupBy,
	};
}
