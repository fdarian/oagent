import type { ReactNode } from 'react';
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import type { TimelinePart } from '@/lib/event-adapter';
import { JobTimelineError } from './job-timeline-error';
import { JobTimelineMessage } from './job-timeline-message';
import { JobTimelineReasoning } from './job-timeline-reasoning';
import { JobTimelineTool } from './job-timeline-tool';

export type JobTimelineProps = {
	parts: TimelinePart[];
	streamingTail: TimelinePart | null;
	cwd: string;
	header?: ReactNode;
	isLoading?: boolean;
};

type ReasoningPart = Extract<TimelinePart, { kind: 'reasoning' }>;

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

function renderPart(part: TimelinePart, cwd: string) {
	switch (part.kind) {
		case 'text':
			return <JobTimelineMessage part={part} />;
		case 'reasoning':
			return <JobTimelineReasoning part={part} />;
		case 'tool':
			return <JobTimelineTool part={part} cwd={cwd} />;
		case 'error':
			return <JobTimelineError part={part} />;
		default:
			return null;
	}
}

export function JobTimeline({
	parts,
	streamingTail,
	cwd,
	header,
	isLoading,
}: JobTimelineProps) {
	const allParts = collapseReasoningParts(
		streamingTail !== null ? [...parts, streamingTail] : parts,
	);

	function partAt(index: number): TimelinePart {
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
					{isLoading ? 'Loading events…' : 'Waiting for events…'}
				</div>
			) : (
				<ConversationContent header={header}>
					{(virtualItem) => (
						<div className="px-33">
							<div className="mx-auto max-w-[900px]">
								{renderPart(partAt(virtualItem.index), cwd)}
							</div>
						</div>
					)}
				</ConversationContent>
			)}
			<ConversationScrollButton />
		</Conversation>
	);
}
