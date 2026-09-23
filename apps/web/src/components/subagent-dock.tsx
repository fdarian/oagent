import { ChevronRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { ChildTimeline } from '@/lib/event-adapter';
import { cn } from '@/lib/utils';
import { SubagentCard } from './job-timeline-subagent';

export type SubagentDockProps = {
	sessions: ReadonlyMap<string, ChildTimeline>;
	scopeSessionId?: string;
	activeChildSessionId: string | undefined;
	onSelect: (sessionId: string) => void;
	className?: string;
};

export function getRunningSubagentSessions(
	sessions: ReadonlyMap<string, ChildTimeline>,
	scopeSessionId: string | undefined,
): ChildTimeline[] {
	return Array.from(sessions.values()).filter(
		(child) =>
			child.status === 'running' &&
			(scopeSessionId === undefined || child.parentId === scopeSessionId),
	);
}

function descriptionForChild(child: ChildTimeline): string {
	return child.description === undefined ? child.title : child.description;
}

export function SubagentDock(props: SubagentDockProps) {
	const running = getRunningSubagentSessions(
		props.sessions,
		props.scopeSessionId,
	);
	if (running.length === 0) return null;

	return (
		<Collapsible
			defaultOpen={false}
			className={cn('group mb-3 w-full', props.className)}
		>
			<CollapsibleTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-auto w-full justify-start px-0 py-1 text-muted-foreground hover:bg-transparent hover:text-foreground -translate-x-2.5 animate-pulse"
				>
					<span>
						{running.length} running {running.length === 1 ? 'agent' : 'agents'}
					</span>
					<ChevronRightIcon
						className={cn(
							'size-3.5 shrink-0 opacity-0 transition-all group-hover:opacity-100',
							'group-data-[state=open]:rotate-90',
						)}
					/>
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent className="ml-1 max-h-[min(320px,40vh)] overflow-y-auto border-border border-l pl-4 pt-1">
				<div className="flex w-full flex-col gap-2">
					{running.map((child) => {
						const isActive = props.activeChildSessionId === child.id;
						return (
							<SubagentCard
								key={child.id}
								agentName={child.agentName}
								description={descriptionForChild(child)}
								status={child.status}
								onSelect={() => props.onSelect(child.id)}
								active={isActive}
								className="job-timeline-subagent--dock w-full justify-start"
							/>
						);
					})}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
