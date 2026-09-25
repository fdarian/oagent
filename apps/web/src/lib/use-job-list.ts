import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { groupByDay } from './format.ts';
import type { Backend } from './harnesses.ts';
import { orpc } from './orpc.ts';
import { useJobListStream } from './use-job-list-stream.ts';

export type JobListItem = {
	id: string;
	status: string;
	createdAt: number;
	terminatedAt?: number;
	prompt: string;
	cwd: string;
	backend: Backend;
	model?: string;
	agentType?: string;
	sessionId?: string;
};

export function useJobList() {
	useJobListStream();

	const { data, isLoading } = useQuery(orpc.jobs.list.queryOptions());

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
