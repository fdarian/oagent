import type { TimelinePart } from '@/lib/event-adapter';
import { JobTimelineError } from './job-timeline-error';
import { JobTimelineMessage } from './job-timeline-message';
import { JobTimelineReasoning } from './job-timeline-reasoning';
import { JobTimelineTool } from './job-timeline-tool';

export type JobTimelineProps = {
	parts: TimelinePart[];
	streamingTail: TimelinePart | null;
};

function renderPart(part: TimelinePart) {
	switch (part.kind) {
		case 'text':
			return <JobTimelineMessage key={part.id} part={part} />;
		case 'reasoning':
			return <JobTimelineReasoning key={part.id} part={part} />;
		case 'tool':
			return <JobTimelineTool key={part.id} part={part} />;
		case 'error':
			return <JobTimelineError key={part.id} part={part} />;
		default:
			return null;
	}
}

export function JobTimeline({ parts, streamingTail }: JobTimelineProps) {
	if (parts.length === 0 && streamingTail === null) {
		return (
			<div className="flex items-center justify-center py-66 text-caption text-muted-foreground">
				Waiting for events…
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-22">
			{parts.map((part) => renderPart(part))}
			{streamingTail !== null && renderPart(streamingTail)}
		</div>
	);
}
