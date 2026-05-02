import { JobSidebarFilters } from './job-sidebar-filters';
import { JobSidebarList } from './job-sidebar-list';
import type { JobListItem } from '@/lib/use-job-list';

export type JobSidebarProps = {
  grouped: { label: string; items: JobListItem[] }[];
  selectedId?: string;
  isLoading: boolean;
  cwdFilter: string;
  onCwdFilterChange: (value: string) => void;
  onSelectJob: (id: string) => void;
};

export function JobSidebar({
  grouped,
  selectedId,
  isLoading,
  cwdFilter,
  onCwdFilterChange,
  onSelectJob,
}: JobSidebarProps) {
  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-r border-[var(--color-steel)] bg-[var(--color-canvas)]">
      <div className="flex items-center justify-between px-[var(--card-padding)] py-[var(--element-gap)]">
        <span className="text-[var(--text-subheading)] font-[var(--font-weight-light)] text-[var(--color-ink)]">
          oagent
        </span>
      </div>
      <JobSidebarFilters
        cwdFilter={cwdFilter}
        onCwdFilterChange={onCwdFilterChange}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && grouped.length === 0 ? (
          <div className="px-[var(--card-padding)] py-[var(--spacing-22)] text-[var(--text-caption)] text-[var(--color-smoke)]">
            Loading…
          </div>
        ) : grouped.length === 0 ? (
          <div className="px-[var(--card-padding)] py-[var(--spacing-22)] text-[var(--text-caption)] text-[var(--color-smoke)]">
            No jobs found
          </div>
        ) : (
          <div className="flex flex-col pb-[var(--spacing-22)]">
            {grouped.map((group) => (
              <JobSidebarList
                key={group.label}
                groups={group}
                selectedId={selectedId}
                onSelect={onSelectJob}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
