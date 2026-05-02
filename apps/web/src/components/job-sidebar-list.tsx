import { formatAge } from '@/lib/format';
import type { JobListItem } from '@/lib/use-job-list';
import { cn } from '@/lib/utils';

export type JobSidebarListProps = {
  groups: { label: string; items: JobListItem[] };
  selectedId?: string;
  onSelect: (id: string) => void;
};

function statusDotClass(status: string): string {
  if (status === 'running') return 'bg-verdant-accent';
  if (status === 'done') return 'bg-primary';
  return 'bg-destructive';
}

export function JobSidebarList({
  groups,
  selectedId,
  onSelect,
}: JobSidebarListProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-[var(--card-padding)] py-[var(--element-gap)]">
        <span className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
          {groups.label}
        </span>
        <span className="text-[13px] font-medium text-muted-foreground">
          {groups.items.length}
        </span>
      </div>
      <div className="flex flex-col">
        {groups.items.map((job) => {
          const isSelected = job.id === selectedId;
          const promptPreview =
            job.prompt.split('\n')[0]?.slice(0, 80) ?? job.id;
          return (
            <button
              key={job.id}
              type="button"
              onClick={() => onSelect(job.id)}
              className={cn(
                'flex flex-col gap-[6px] border-l px-[var(--card-padding)] py-[var(--element-gap)] text-left transition-colors',
                isSelected
                  ? 'border-l-ink bg-[color-mix(in_srgb,var(--color-ink)_3%,var(--color-canvas))]'
                  : 'border-l-transparent hover:bg-[color-mix(in_srgb,var(--color-ink)_1%,var(--color-canvas))]',
              )}
            >
              <div className="flex items-center gap-[var(--element-gap)]">
                <span
                  className={cn(
                    'inline-block h-[6px] w-[6px] shrink-0',
                    statusDotClass(job.status),
                  )}
                />
                <span className="truncate text-[var(--text-caption)] font-light text-foreground">
                  {promptPreview}
                </span>
              </div>
              <div className="flex items-center gap-[var(--element-gap)] text-[var(--text-caption)] text-muted-foreground">
                <span className="truncate">{job.cwd}</span>
                <span>·</span>
                <span>{formatAge(job.createdAt)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
