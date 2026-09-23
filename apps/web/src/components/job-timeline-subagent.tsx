import { ExternalLinkIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Badge } from '@/components/ui/badge';
import {
	type ChildSessionStatus,
	type ChildTimeline,
	getSubagentToolDetails,
	type TimelineToolPart,
} from '@/lib/event-adapter';
import { cn } from '@/lib/utils';
import './job-timeline-subagent.css';

const progressDots = Array.from({ length: 25 }, (_, index) => ({
	index,
	x: 1.5 + (index % 5) * 3,
	y: 1.5 + Math.floor(index / 5) * 3,
}));

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

export type SubagentCardProps = {
	agentName?: string;
	fallbackLabel?: string;
	description?: string;
	status: ChildSessionStatus;
	onSelect?: () => void;
	active?: boolean;
	className?: string;
	ariaLabel?: string;
};

function statusFromPart(part: TimelineToolPart): ChildSessionStatus {
	if (part.state === 'output-error') return 'failed';
	if (part.state === 'output-available') return 'completed';
	return 'running';
}

function capitalize(value: string): string {
	if (value.length === 0) return value;
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function agentLabel(
	agentName: string | undefined,
	fallbackLabel: string | undefined,
): string {
	if (agentName !== undefined && agentName.length > 0) {
		return capitalize(agentName);
	}
	if (fallbackLabel !== undefined) {
		const fallbackTitle = fallbackLabel.toLowerCase();
		if (
			fallbackTitle !== 'subagent' &&
			fallbackTitle !== 'task' &&
			fallbackLabel.length > 0
		) {
			return capitalize(fallbackLabel);
		}
	}
	return 'General';
}

function descriptionFor(
	description: string | undefined,
	child: ChildTimeline | undefined,
	part: TimelineToolPart,
): string | undefined {
	if (description !== undefined && description.length > 0) return description;
	if (child?.description !== undefined && child.description.length > 0) {
		return child.description;
	}
	if (child?.title !== undefined && child.title.length > 0) return child.title;
	const partTitle = part.title.toLowerCase();
	if (partTitle === 'subagent' || partTitle === 'task') return undefined;
	return part.title.length > 0 ? part.title : undefined;
}

function agentColor(agentName: string | undefined): string {
	switch (agentName?.toLowerCase()) {
		case 'build':
			return '#2c47c8';
		case 'explore':
			return '#ac8833';
		case 'plan':
			return '#c83d8b';
		case 'review':
			return '#198b43';
		case 'writer':
			return '#623be2';
		default:
			return '#007b80';
	}
}

function SubagentIcon() {
	return (
		<svg
			aria-hidden="true"
			className="job-timeline-subagent__icon"
			fill="none"
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M4.5 5C4.5 4.72386 4.72386 4.5 5 4.5H11C11.2761 4.5 11.5 4.72386 11.5 5V11C11.5 11.2761 11.2761 11.5 11 11.5H5C4.72386 11.5 4.5 11.2761 4.5 11V5Z"
				fill="currentColor"
			/>
			<path
				d="M13.5 2C13.7761 2 14 2.22386 14 2.5V13.5C14 13.7761 13.7761 14 13.5 14H2.5C2.22386 14 2 13.7761 2 13.5V2.5C2 2.22386 2.22386 2 2.5 2H13.5ZM3 13H13V3H3V13Z"
				fill="currentColor"
			/>
		</svg>
	);
}

function SubagentProgressIndicator() {
	return (
		<svg
			aria-hidden="true"
			className="job-timeline-subagent__progress"
			fill="none"
			viewBox="0 0 16 16"
			xmlns="http://www.w3.org/2000/svg"
		>
			{progressDots.map((dot) => (
				<rect
					data-dot={dot.index}
					key={dot.index}
					height="2"
					style={
						{
							animationDelay: `${-dot.index * 45}ms`,
						} satisfies CSSProperties
					}
					width="2"
					x={dot.x}
					y={dot.y}
				/>
			))}
		</svg>
	);
}

export function SubagentCard(props: SubagentCardProps) {
	const canOpen = props.onSelect !== undefined;
	const running = props.status === 'running';
	const label = agentLabel(props.agentName, props.fallbackLabel);
	const accessibleDescription =
		props.description === undefined ? label : `${label}: ${props.description}`;
	const ariaLabel =
		props.ariaLabel !== undefined
			? props.ariaLabel
			: canOpen
				? `Open subagent timeline: ${accessibleDescription}`
				: `Subagent timeline is not available yet: ${accessibleDescription}`;

	const handleClick = () => {
		props.onSelect?.();
	};

	return (
		<button
			type="button"
			disabled={!canOpen}
			onClick={handleClick}
			data-component="task-tool-card"
			data-active={props.active ? 'true' : undefined}
			aria-current={props.active ? 'true' : undefined}
			aria-label={ariaLabel}
			className={cn(
				'group/subagent job-timeline-subagent',
				props.className,
				canOpen
					? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
					: 'cursor-default',
			)}
		>
			<span
				className="job-timeline-subagent__surface"
				data-component="task-tool-surface"
				style={{ color: agentColor(props.agentName) }}
			>
				{running ? (
					<span data-component="task-tool-spinner">
						<SubagentProgressIndicator />
					</span>
				) : (
					<span data-component="task-tool-icon">
						<SubagentIcon />
					</span>
				)}
				<span className="job-timeline-subagent__info">
					<span
						className="job-timeline-subagent__title"
						data-component="task-tool-title"
						data-running={running ? 'true' : 'false'}
					>
						{label}
					</span>
					{props.description !== undefined && (
						<span
							className="job-timeline-subagent__description"
							data-slot="basic-tool-tool-subtitle"
						>
							{props.description}
						</span>
					)}
				</span>
			</span>
			{canOpen && (
				<span
					className="job-timeline-subagent__action"
					data-component="task-tool-action"
					aria-hidden="true"
				>
					<ExternalLinkIcon className="size-4" />
				</span>
			)}
		</button>
	);
}

export function JobTimelineSubagent(props: JobTimelineSubagentProps) {
	const details = getSubagentToolDetails(props.part);
	const child = props.child;
	const canOpen = child !== undefined && props.onSelect !== undefined;
	const toolStatus = statusFromPart(props.part);
	const status =
		toolStatus === 'running' && child !== undefined ? child.status : toolStatus;
	const description = descriptionFor(details.description, child, props.part);

	const handleClick = () => {
		if (!canOpen || child === undefined || props.onSelect === undefined) return;
		props.onSelect(child.id);
	};

	return (
		<SubagentCard
			agentName={details.agentName}
			fallbackLabel={props.part.title}
			description={description}
			status={status}
			onSelect={canOpen ? handleClick : undefined}
			className="mb-4 -translate-x-3"
		/>
	);
}
