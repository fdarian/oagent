import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { ChildTimeline, TimelinePart } from '@/lib/event-adapter';
import { cn } from '@/lib/utils';
import { JobTimelineError } from './job-timeline-error';
import { JobTimelineMessage } from './job-timeline-message';
import { JobTimelineReasoning } from './job-timeline-reasoning';
import { JobTimelineSteer } from './job-timeline-steer';
import { JobTimelineTool } from './job-timeline-tool';

export type JobTimelineProps = {
	parts: TimelinePart[];
	streamingTail: TimelinePart | null;
	cwd: string;
	header?: ReactNode;
	isLoading?: boolean;
	contentClassName?: string;
	childSessions?: ReadonlyMap<string, ChildTimeline>;
	currentChild?: ChildTimeline;
	onChildSelect?: (sessionId: string) => void;
	isChildTimeline?: boolean;
};

type ReasoningPart = Extract<TimelinePart, { kind: 'reasoning' }>;
type ToolPart = Extract<TimelinePart, { kind: 'tool' }>;

type ExplorationGroup = {
	kind: 'exploration';
	id: string;
	parts: ToolPart[];
};

type TimelineItem = TimelinePart | ExplorationGroup;

function collapseReasoningParts(parts: TimelinePart[]): TimelinePart[] {
	const collapsed: TimelinePart[] = [];

	for (const part of parts) {
		const previous = collapsed[collapsed.length - 1];
		if (previous?.kind !== 'reasoning' || part.kind !== 'reasoning') {
			collapsed.push(part);
			continue;
		}

		const durationMs =
			previous.durationMs !== undefined && part.durationMs !== undefined
				? previous.durationMs + part.durationMs
				: previous.durationMs !== undefined
					? previous.durationMs
					: part.durationMs;
		const merged: ReasoningPart = {
			kind: 'reasoning',
			id: previous.id,
			text: `${previous.text}  \n${part.text}`,
			isStreaming: previous.isStreaming || part.isStreaming,
			createdAt: previous.createdAt,
		};
		if (durationMs !== undefined) {
			merged.durationMs = durationMs;
		}
		collapsed[collapsed.length - 1] = merged;
	}

	return collapsed;
}

function isExplorationTool(part: TimelinePart): part is ToolPart {
	if (part.kind !== 'tool') return false;
	return (
		part.toolKind === 'execute' ||
		part.toolKind === 'search' ||
		part.toolKind === 'read'
	);
}

function collapseExplorationParts(parts: TimelinePart[]): TimelineItem[] {
	const grouped: TimelineItem[] = [];

	for (const part of parts) {
		if (!isExplorationTool(part)) {
			grouped.push(part);
			continue;
		}

		const previous = grouped[grouped.length - 1];
		if (previous?.kind !== 'exploration') {
			grouped.push({ kind: 'exploration', id: part.id, parts: [part] });
			continue;
		}

		grouped[grouped.length - 1] = {
			kind: 'exploration',
			id: previous.id,
			parts: [...previous.parts, part],
		};
	}

	return grouped.flatMap((item) =>
		item.kind === 'exploration' && item.parts.length === 1
			? item.parts
			: [item],
	);
}

function countLabel(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function explorationSummary(parts: ToolPart[]): string {
	let shells = 0;
	let searches = 0;
	let reads = 0;

	for (const part of parts) {
		switch (part.toolKind) {
			case 'execute':
				shells += 1;
				break;
			case 'search':
				searches += 1;
				break;
			case 'read':
				reads += 1;
				break;
		}
	}

	const counts: string[] = [];
	if (shells > 0) counts.push(countLabel(shells, 'shell', 'shells'));
	if (searches > 0) counts.push(countLabel(searches, 'search', 'searches'));
	if (reads > 0) counts.push(countLabel(reads, 'read', 'reads'));
	return counts.join(', ');
}

function ExplorationGroup(props: {
	group: ExplorationGroup;
	cwd: string;
	currentChild: ChildTimeline | undefined;
}) {
	return (
		<Collapsible defaultOpen={false} className="group mb-3 w-full">
			<CollapsibleTrigger className="flex w-full items-center gap-1.5 py-1 text-left">
				<span className="shrink-0 font-medium text-sm">Explored</span>
				<span className="min-w-0 truncate text-sm text-muted-foreground">
					— {explorationSummary(props.group.parts)}
				</span>
				<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-data-[state=open]:rotate-90" />
			</CollapsibleTrigger>
			<CollapsibleContent className="ml-1 border-border border-l pl-4 pt-1">
				{props.group.parts.map((part) => (
					<JobTimelineTool
						key={part.id}
						part={part}
						cwd={props.cwd}
						currentChild={props.currentChild}
					/>
				))}
			</CollapsibleContent>
		</Collapsible>
	);
}

function renderPart(
	part: TimelineItem,
	cwd: string,
	childSessions: ReadonlyMap<string, ChildTimeline> | undefined,
	currentChild: ChildTimeline | undefined,
	onChildSelect: ((sessionId: string) => void) | undefined,
) {
	if (part.kind === 'exploration') {
		return (
			<ExplorationGroup group={part} cwd={cwd} currentChild={currentChild} />
		);
	}

	switch (part.kind) {
		case 'text':
			return <JobTimelineMessage part={part} />;
		case 'steer':
		case 'user':
			return <JobTimelineSteer part={part} />;
		case 'reasoning':
			return <JobTimelineReasoning part={part} />;
		case 'tool':
			return (
				<JobTimelineTool
					part={part}
					cwd={cwd}
					childSessions={childSessions}
					currentChild={currentChild}
					onChildSelect={onChildSelect}
				/>
			);
		case 'error':
			return <JobTimelineError part={part} />;
		default:
			return null;
	}
}

export function JobTimeline(props: JobTimelineProps) {
	const allParts = collapseExplorationParts(
		collapseReasoningParts(
			props.streamingTail !== null
				? [...props.parts, props.streamingTail]
				: props.parts,
		),
	);

	function partAt(index: number): TimelineItem {
		const part = allParts[index];
		if (part === undefined) {
			throw new Error(
				`Timeline part at index ${index} is undefined (length: ${allParts.length})`,
			);
		}
		return part;
	}

	return (
		<Conversation
			count={allParts.length}
			getItemKey={(index) => partAt(index).id}
			estimateSize={() => 72}
			className="min-h-0 flex-1"
		>
			{allParts.length === 0 ? (
				<div className="flex items-center justify-center py-66 text-caption text-muted-foreground">
					{props.isLoading ? 'Loading events…' : 'Waiting for events…'}
				</div>
			) : (
				<ConversationContent header={props.header}>
					{(virtualItem) => (
						<div className={cn('px-33', props.contentClassName)}>
							<div className="mx-auto max-w-[900px]">
								{renderPart(
									partAt(virtualItem.index),
									props.cwd,
									props.childSessions,
									props.currentChild,
									props.onChildSelect,
								)}
							</div>
						</div>
					)}
				</ConversationContent>
			)}
			<ConversationScrollButton />
		</Conversation>
	);
}
