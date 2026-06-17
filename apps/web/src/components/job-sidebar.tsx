import { Link } from '@tanstack/react-router';
import { SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import type { JobListItem } from '@/lib/use-job-list';
import { cn } from '@/lib/utils';
import { JobSidebarFilters } from './job-sidebar-filters';
import { JobSidebarList, JobSidebarSessionList } from './job-sidebar-list';
import { ThemeToggle } from './theme-toggle';

export type JobSidebarProps = {
	grouped: { label: string; items: JobListItem[] }[];
	jobs: JobListItem[];
	selectedId?: string;
	isLoading: boolean;
	cwdFilter: string;
	onCwdFilterChange: (value: string) => void;
};

type View = 'jobs' | 'sessions';

export function JobSidebar({
	grouped,
	jobs,
	selectedId,
	isLoading,
	cwdFilter,
	onCwdFilterChange,
}: JobSidebarProps) {
	const [view, setView] = useState<View>('jobs');

	const isEmpty = view === 'jobs' ? grouped.length === 0 : jobs.length === 0;

	return (
		<div className="flex h-full w-[360px] shrink-0 flex-col border-r border-border bg-background">
			<div className="flex items-center justify-between px-22 py-15">
				<span className="text-subheading font-light text-foreground">
					oagent
				</span>
				<div className="flex items-center gap-1">
					<Link
						to="/settings"
						className="flex items-center justify-center rounded-md border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
					>
						<SettingsIcon className="size-4" />
						<span className="sr-only">Settings</span>
					</Link>
					<ThemeToggle />
				</div>
			</div>
			<div className="flex items-center gap-1 border-b border-border px-22 py-15">
				<button
					type="button"
					onClick={() => setView('jobs')}
					className={cn(
						'flex-1 rounded-md py-1 text-caption font-medium transition-colors',
						view === 'jobs'
							? 'bg-[color-mix(in_srgb,var(--color-ink)_8%,var(--color-canvas))] text-foreground'
							: 'text-muted-foreground hover:text-foreground',
					)}
				>
					Jobs
				</button>
				<button
					type="button"
					onClick={() => setView('sessions')}
					className={cn(
						'flex-1 rounded-md py-1 text-caption font-medium transition-colors',
						view === 'sessions'
							? 'bg-[color-mix(in_srgb,var(--color-ink)_8%,var(--color-canvas))] text-foreground'
							: 'text-muted-foreground hover:text-foreground',
					)}
				>
					Sessions
				</button>
			</div>
			<JobSidebarFilters
				cwdFilter={cwdFilter}
				onCwdFilterChange={onCwdFilterChange}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{isLoading && isEmpty ? (
					<div className="px-22 py-22 text-caption text-muted-foreground">
						Loading…
					</div>
				) : isEmpty ? (
					<div className="px-22 py-22 text-caption text-muted-foreground">
						No jobs found
					</div>
				) : view === 'jobs' ? (
					<div className="flex flex-col pb-22">
						{grouped.map((group) => (
							<JobSidebarList
								key={group.label}
								groups={group}
								selectedId={selectedId}
							/>
						))}
					</div>
				) : (
					<div className="flex flex-col pb-22">
						<JobSidebarSessionList jobs={jobs} selectedId={selectedId} />
					</div>
				)}
			</div>
		</div>
	);
}
