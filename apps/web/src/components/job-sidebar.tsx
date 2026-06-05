import { Link } from '@tanstack/react-router';
import type { JobListItem } from '@/lib/use-job-list';
import { JobSidebarFilters } from './job-sidebar-filters';
import { JobSidebarList } from './job-sidebar-list';
import { ThemeToggle } from './theme-toggle';

export type JobSidebarProps = {
	grouped: { label: string; items: JobListItem[] }[];
	selectedId?: string;
	isLoading: boolean;
	cwdFilter: string;
	onCwdFilterChange: (value: string) => void;
};

export function JobSidebar({
	grouped,
	selectedId,
	isLoading,
	cwdFilter,
	onCwdFilterChange,
}: JobSidebarProps) {
	return (
		<div className="flex h-full w-[360px] shrink-0 flex-col border-r border-border bg-background">
			<div className="flex items-center justify-between px-22 py-15">
				<span className="text-subheading font-light text-foreground">
					oagent
				</span>
				<ThemeToggle />
			</div>
			<div className="flex items-center justify-between border-b border-border px-22 py-15">
				<Link
					to="/aliases"
					className="text-caption text-muted-foreground hover:text-foreground"
				>
					Aliases
				</Link>
			</div>
			<JobSidebarFilters
				cwdFilter={cwdFilter}
				onCwdFilterChange={onCwdFilterChange}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{isLoading && grouped.length === 0 ? (
					<div className="px-22 py-22 text-caption text-muted-foreground">
						Loading…
					</div>
				) : grouped.length === 0 ? (
					<div className="px-22 py-22 text-caption text-muted-foreground">
						No jobs found
					</div>
				) : (
					<div className="flex flex-col pb-22">
						{grouped.map((group) => (
							<JobSidebarList
								key={group.label}
								groups={group}
								selectedId={selectedId}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
