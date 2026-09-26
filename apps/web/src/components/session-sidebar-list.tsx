import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon } from 'lucide-react';
import { formatAge } from '@/lib/format';
import { warmUpJobEvents } from '@/lib/job-warmup';
import { orpc } from '@/lib/orpc';
import type { SessionListItem } from '@/lib/use-session-list';
import { cn } from '@/lib/utils';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from './ui/collapsible';

function statusDotClass(status: string): string {
	if (status === 'running') return 'bg-verdant-accent';
	if (status === 'done') return 'bg-primary';
	return 'bg-destructive';
}

function SessionSidebarItem(props: {
	session: SessionListItem;
	selectedId?: string;
	selectedJobId?: string;
}) {
	const session = props.session;
	const queryClient = useQueryClient();
	const warmUp = () => {
		warmUpJobEvents(session.jobId, props.selectedJobId);
		void queryClient.prefetchQuery(
			orpc.sessions.get.queryOptions({ input: { sessionId: session.id } }),
		);
	};
	return (
		<Link
			to="/sessions/$sessionId"
			params={{ sessionId: session.id }}
			onMouseEnter={warmUp}
			onFocus={warmUp}
			className={cn(
				'flex flex-col gap-[6px] border-l px-22 py-15 text-left transition-colors',
				session.id === props.selectedId
					? 'border-l-ink bg-[color-mix(in_srgb,var(--color-ink)_3%,var(--color-canvas))] dark:bg-[color-mix(in_srgb,var(--color-ink)_8%,var(--color-canvas))]'
					: 'border-l-transparent hover:bg-[color-mix(in_srgb,var(--color-ink)_1%,var(--color-canvas))] dark:hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,var(--color-canvas))]',
			)}
		>
			<div className="flex items-center gap-15">
				<span
					className={cn(
						'inline-block h-[6px] w-[6px] shrink-0',
						statusDotClass(session.status),
					)}
				/>
				<span className="truncate text-caption font-light text-foreground">
					{session.title || session.prompt}
				</span>
			</div>
			<div className="flex items-center gap-15 text-caption text-muted-foreground">
				<span className="truncate">{session.cwd}</span>
				<span>·</span>
				<span>{formatAge(session.createdAt)}</span>
			</div>
		</Link>
	);
}

export function SessionSidebarGroup(props: {
	label: string;
	items: SessionListItem[];
	selectedId?: string;
	selectedJobId?: string;
}) {
	return (
		<Collapsible defaultOpen className="group flex flex-col">
			<CollapsibleTrigger className="flex w-full items-center justify-between px-22 py-15 text-left">
				<span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
					{props.label}
				</span>
				<div className="flex items-center gap-10">
					<span className="text-caption font-medium text-muted-foreground">
						{props.items.length}
					</span>
					<ChevronRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
				</div>
			</CollapsibleTrigger>
			<CollapsibleContent className="flex flex-col">
				{props.items.map((session) => (
					<SessionSidebarItem
						key={session.id}
						session={session}
						selectedId={props.selectedId}
						selectedJobId={props.selectedJobId}
					/>
				))}
			</CollapsibleContent>
		</Collapsible>
	);
}
