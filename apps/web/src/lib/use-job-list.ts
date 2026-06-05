import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { groupByDay } from './format.ts';
import { orpc } from './orpc.ts';
import { queryKeys } from './query-keys.ts';
import { useJobListStream } from './use-job-list-stream.ts';

export type JobListItem = {
	id: string;
	status: string;
	createdAt: number;
	terminatedAt?: number;
	prompt: string;
	cwd: string;
	model?: string;
};

export function useJobList() {
	useJobListStream();

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.jobs(),
		queryFn: () => orpc.jobs.list(),
	});

	const [cwdFilter, setCwdFilter] = useState('');

	const filtered = useMemo(() => {
		const jobs = (data ?? []) as JobListItem[];
		if (cwdFilter.trim() === '') return jobs;
		const needle = cwdFilter.toLowerCase();
		return jobs.filter((j) => j.cwd.toLowerCase().includes(needle));
	}, [data, cwdFilter]);

	const grouped = useMemo(() => groupByDay(filtered), [filtered]);

	return {
		jobs: filtered,
		grouped,
		isLoading,
		cwdFilter,
		setCwdFilter,
	};
}
