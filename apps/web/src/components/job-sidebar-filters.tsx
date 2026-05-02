import { SearchIcon } from 'lucide-react';

export type JobSidebarFiltersProps = {
  cwdFilter: string;
  onCwdFilterChange: (value: string) => void;
};

export function JobSidebarFilters({
  cwdFilter,
  onCwdFilterChange,
}: JobSidebarFiltersProps) {
  return (
    <div className="flex items-center gap-[var(--element-gap)] border-b border-[var(--color-steel)] px-[var(--card-padding)] py-[var(--element-gap)]">
      <SearchIcon className="h-3.5 w-3.5 shrink-0 text-[var(--color-smoke)]" />
      <input
        type="text"
        value={cwdFilter}
        onChange={(e) => onCwdFilterChange(e.target.value)}
        placeholder="Filter by working dir…"
        className="w-full bg-transparent text-[var(--text-caption)] font-[var(--font-weight-light)] text-[var(--color-ink)] placeholder:text-[var(--color-smoke)] outline-none"
      />
    </div>
  );
}
