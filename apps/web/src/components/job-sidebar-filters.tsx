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
    <div className="flex items-center gap-15 border-b border-border px-22 py-15">
      <SearchIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        type="text"
        value={cwdFilter}
        onChange={(e) => onCwdFilterChange(e.target.value)}
        placeholder="Filter by working dir…"
        className="w-full bg-transparent text-caption font-light text-foreground placeholder:text-muted-foreground outline-none"
      />
    </div>
  );
}
