import { ChevronLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChildTimeline } from '@/lib/event-adapter';
import { formatElapsed } from '@/lib/format';
import { useClock } from '@/lib/use-clock';
import { SubagentStatusBadge } from './job-timeline-subagent';

export type SubagentHeaderProps = {
	child: ChildTimeline;
	sessions: ReadonlyMap<string, ChildTimeline>;
	onNavigate: (sessionId: string | undefined) => void;
};

function ancestorsForChild(
	child: ChildTimeline,
	children: ReadonlyMap<string, ChildTimeline>,
	seen: ReadonlySet<string> = new Set(),
): ChildTimeline[] {
	if (seen.has(child.id)) return [];
	const parent = children.get(child.parentId);
	if (parent === undefined) return [];
	const nextSeen = new Set(seen);
	nextSeen.add(child.id);
	return [...ancestorsForChild(parent, children, nextSeen), parent];
}

function childDescription(child: ChildTimeline): string {
	return child.description === undefined ? child.title : child.description;
}

export function SubagentHeader(props: SubagentHeaderProps) {
	const parent = props.sessions.get(props.child.parentId);
	const parentId = parent === undefined ? undefined : parent.id;
	const ancestors = ancestorsForChild(props.child, props.sessions);
	const now = useClock(props.child.status === 'running');
	const elapsed = formatElapsed(
		props.child.startedAt,
		props.child.endedAt === undefined ? now : props.child.endedAt,
	);

	return (
		<div className="border-primary border-b bg-primary/10 px-33 py-15">
			<div className="mx-auto flex max-w-[900px] items-center gap-15">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => props.onNavigate(parentId)}
					className="h-auto max-w-56 shrink-0 justify-start rounded-none px-0 py-1 text-muted-foreground hover:bg-transparent hover:text-foreground"
				>
					<ChevronLeftIcon className="size-4" />
					<span className="truncate">
						{parent === undefined
							? 'Back to parent job'
							: `Back to ${childDescription(parent)}`}
					</span>
				</Button>

				<div className="min-w-0 flex-1">
					{props.child.depth > 1 && (
						<nav
							aria-label="Subagent breadcrumb"
							className="mb-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-caption text-muted-foreground"
						>
							<button
								type="button"
								onClick={() => props.onNavigate(undefined)}
								className="shrink-0 transition-colors hover:text-foreground"
							>
								Parent job
							</button>
							{ancestors.map((ancestor) => (
								<span
									key={ancestor.id}
									className="flex min-w-0 items-center gap-1.5"
								>
									<span aria-hidden="true">/</span>
									<button
										type="button"
										onClick={() => props.onNavigate(ancestor.id)}
										className="max-w-48 truncate transition-colors hover:text-foreground"
									>
										{childDescription(ancestor)}
									</button>
								</span>
							))}
							<span aria-hidden="true">/</span>
							<span className="min-w-0 truncate text-foreground">
								{childDescription(props.child)}
							</span>
						</nav>
					)}

					<div className="flex min-w-0 items-baseline gap-2">
						{props.child.agentName !== undefined && (
							<span className="shrink-0 font-medium text-sm">
								{props.child.agentName}
							</span>
						)}
						<span className="min-w-0 truncate text-body font-light">
							{childDescription(props.child)}
						</span>
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-2">
					<SubagentStatusBadge status={props.child.status} />
					<span className="text-caption text-muted-foreground">{elapsed}</span>
				</div>
			</div>
		</div>
	);
}
