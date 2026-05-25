import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { groupByDay } from './format.ts';
import { orpc } from './orpc.ts';

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
  const { data, isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => orpc.jobs.list(),
    refetchInterval: (query) => {
      if (query.state.data?.some((j) => j.status === 'running')) {
        return 2000;
      }
      return false;
    },
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
