import { Link } from '@tanstack/react-router';
import { SettingsIcon } from 'lucide-react';
import type { SessionListItem } from '@/lib/use-session-list';
import { SessionSidebarFilters } from './session-sidebar-filters';
import { SessionSidebarGroup } from './session-sidebar-list';
import { ThemeToggle } from './theme-toggle';

export type SessionSidebarProps = {
	grouped: { label: string; items: SessionListItem[] }[];
	selectedId?: string;
	isLoading: boolean;
	cwdFilter: string;
	onCwdFilterChange: (value: string) => void;
};

export function SessionSidebar(props: SessionSidebarProps) {
	return (
		<div className="flex h-[40vh] w-full shrink-0 flex-col border-b border-border bg-background sm:h-full sm:w-[360px] sm:border-r sm:border-b-0">
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
			<SessionSidebarFilters
				cwdFilter={props.cwdFilter}
				onCwdFilterChange={props.onCwdFilterChange}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{props.grouped.length === 0 ? (
					<div className="px-22 py-22 text-caption text-muted-foreground">
						{props.isLoading ? 'Loading…' : 'No sessions found'}
					</div>
				) : (
					<div className="flex flex-col pb-22">
						{props.grouped.map((group) => (
							<SessionSidebarGroup
								key={group.label}
								label={group.label}
								items={group.items}
								selectedId={props.selectedId}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
