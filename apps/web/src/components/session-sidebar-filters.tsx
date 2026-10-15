import { SearchIcon, SlidersHorizontalIcon } from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	isSessionGroupBy,
	SESSION_GROUP_BY_OPTIONS,
	type SessionGroupBy,
} from '@/lib/session-grouping';

export type SessionSidebarFiltersProps = {
	cwdFilter: string;
	onCwdFilterChange: (value: string) => void;
	groupBy: SessionGroupBy;
	onGroupByChange: (value: SessionGroupBy) => void;
};

export function SessionSidebarFilters(props: SessionSidebarFiltersProps) {
	return (
		<div className="flex items-center gap-15 border-b border-border px-22 py-15">
			<SearchIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<input
				type="text"
				value={props.cwdFilter}
				onChange={(e) => props.onCwdFilterChange(e.target.value)}
				placeholder="Filter by working dir…"
				className="w-full bg-transparent text-caption font-light text-foreground placeholder:text-muted-foreground outline-none"
			/>
			<DropdownMenu>
				<DropdownMenuTrigger className="flex shrink-0 items-center justify-center rounded-md border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground">
					<SlidersHorizontalIcon className="size-4" />
					<span className="sr-only">Group sessions</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuGroup>
						<DropdownMenuLabel>Group by</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							value={props.groupBy}
							onValueChange={(value) => {
								if (typeof value !== 'string' || !isSessionGroupBy(value)) {
									throw new Error(`Invalid group-by option: ${String(value)}`);
								}
								props.onGroupByChange(value);
							}}
						>
							{SESSION_GROUP_BY_OPTIONS.map((option) => (
								<DropdownMenuRadioItem key={option.value} value={option.value}>
									{option.label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
