import { BotIcon, ChevronRightIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
	type ChildSessionStatus,
	type ChildTimeline,
	getSubagentToolDetails,
	type TimelineToolPart,
} from '@/lib/event-adapter';
import { cn } from '@/lib/utils';

export type SubagentStatusBadgeProps = {
	status: ChildSessionStatus;
};

function statusLabel(status: ChildSessionStatus): string {
	if (status === 'completed') return 'Completed';
	if (status === 'failed') return 'Failed';
	return 'Running';
}

export function SubagentStatusBadge(props: SubagentStatusBadgeProps) {
	return (
		<Badge
			variant="outline"
			className={cn(
				'rounded-none bg-transparent px-1.5 py-0 font-light text-caption',
				props.status === 'running'
					? 'border-verdant-accent text-verdant-accent'
					: props.status === 'completed'
						? 'border-primary text-primary'
						: 'border-destructive text-destructive',
			)}
		>
			{statusLabel(props.status)}
		</Badge>
	);
}

export type JobTimelineSubagentProps = {
	part: TimelineToolPart;
	child: ChildTimeline | undefined;
	onSelect?: (sessionId: string) => void;
};

function statusFromPart(part: TimelineToolPart): ChildSessionStatus {
	if (part.state === 'output-error') return 'failed';
	if (part.state === 'output-available') return 'completed';
	return 'running';
}

function countLabel(count: number): string {
	return `${count} ${count === 1 ? 'step' : 'steps'}`;
}

export function JobTimelineSubagent(props: JobTimelineSubagentProps) {
	const details = getSubagentToolDetails(props.part);
	const child = props.child;
	const canOpen = child !== undefined && props.onSelect !== undefined;
	const status =
		child === undefined ? statusFromPart(props.part) : child.status;
	const description =
		details.description === undefined ? props.part.title : details.description;
	const stepCount =
		child === undefined
			? undefined
			: child.parts.length + (child.streamingTail === null ? 0 : 1);

	const handleClick = () => {
		if (child === undefined || props.onSelect === undefined) return;
		props.onSelect(child.id);
	};

	return (
		<button
			type="button"
			disabled={!canOpen}
			onClick={handleClick}
			aria-label={
				canOpen
					? `Open subagent timeline: ${description}`
					: `Subagent timeline is not available yet: ${description}`
			}
			className={cn(
				'group/subagent mb-3 flex w-full items-center gap-15 border-primary border-l-2 px-15 py-10 text-left transition-colors',
				canOpen
					? 'hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
					: 'cursor-default',
			)}
		>
			<BotIcon className="size-4 shrink-0 text-primary" />
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-baseline gap-10">
					{details.agentName !== undefined && (
						<span className="shrink-0 font-medium text-sm">
							{details.agentName}
						</span>
					)}
					<span className="truncate text-sm text-muted-foreground">
						{description}
					</span>
				</div>
				<div className="mt-1 text-caption text-muted-foreground">
					{stepCount === undefined
						? 'Waiting for child activity'
						: countLabel(stepCount)}
				</div>
			</div>
			<SubagentStatusBadge status={status} />
			{canOpen && (
				<ChevronRightIcon className="size-4 shrink-0 text-primary transition-transform group-active/subagent:translate-x-0.5" />
			)}
		</button>
	);
}
