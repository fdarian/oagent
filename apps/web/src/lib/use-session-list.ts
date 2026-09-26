import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { groupByDay } from './format.ts';
import { orpc } from './orpc.ts';
import { useSessionListStream } from './use-session-list-stream.ts';

export type SessionListItem = {
	id: string;
	title: string;
	status: string;
	createdAt: number;
	prompt: string;
	cwd: string;
};

export function useSessionList() {
	useSessionListStream();

	const { data, isLoading } = useQuery(
		orpc.sessions.list.queryOptions({ input: {} }),
	);

	const [cwdFilter, setCwdFilter] = useState('');

	const filtered = useMemo(() => {
		const sessions = data ?? [];
		if (cwdFilter.trim() === '') return sessions;
		const needle = cwdFilter.toLowerCase();
		return sessions.filter((session) =>
			session.cwd.toLowerCase().includes(needle),
		);
	}, [data, cwdFilter]);

	const grouped = useMemo(() => groupByDay(filtered), [filtered]);

	return {
		sessions: filtered,
		grouped,
		isLoading,
		cwdFilter,
		setCwdFilter,
	};
}
