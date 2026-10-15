import { SearchIcon, SlidersHorizontalIcon } from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	isSessionGroupBy,
	SESSION_GROUP_BY_OPTIONS,
	type SessionGroupBy,
} from '@/lib/session-grouping';
import {
	isSessionLastActivity,
	SESSION_LAST_ACTIVITY_OPTIONS,
	type SessionLastActivity,
} from '@/lib/session-last-activity';

export type SessionSidebarFiltersProps = {
	cwdFilter: string;
	onCwdFilterChange: (value: string) => void;
	lastActivity: SessionLastActivity;
	onLastActivityChange: (value: SessionLastActivity) => void;
	groupBy: SessionGroupBy;
	onGroupByChange: (value: SessionGroupBy) => void;
};

function optionLabel<T extends string>(
	options: { value: T; label: string }[],
	value: T,
): string {
	const option = options.find((candidate) => candidate.value === value);
	if (option === undefined) throw new Error(`Unknown option: ${value}`);
	return option.label;
}

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
					<span className="sr-only">Filter and group sessions</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-52">
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<span className="flex-1">Last activity</span>
							<span className="opacity-70">
								{optionLabel(SESSION_LAST_ACTIVITY_OPTIONS, props.lastActivity)}
							</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							<DropdownMenuRadioGroup
								value={props.lastActivity}
								onValueChange={(value) => {
									if (
										typeof value !== 'string' ||
										!isSessionLastActivity(value)
									) {
										throw new Error(
											`Invalid last-activity option: ${String(value)}`,
										);
									}
									props.onLastActivityChange(value);
								}}
							>
								{SESSION_LAST_ACTIVITY_OPTIONS.map((option) => (
									<DropdownMenuRadioItem
										key={option.value}
										value={option.value}
									>
										{option.label}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<span className="flex-1">Group by</span>
							<span className="opacity-70">
								{optionLabel(SESSION_GROUP_BY_OPTIONS, props.groupBy)}
							</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							<DropdownMenuRadioGroup
								value={props.groupBy}
								onValueChange={(value) => {
									if (typeof value !== 'string' || !isSessionGroupBy(value)) {
										throw new Error(
											`Invalid group-by option: ${String(value)}`,
										);
									}
									props.onGroupByChange(value);
								}}
							>
								{SESSION_GROUP_BY_OPTIONS.map((option) => (
									<DropdownMenuRadioItem
										key={option.value}
										value={option.value}
									>
										{option.label}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
