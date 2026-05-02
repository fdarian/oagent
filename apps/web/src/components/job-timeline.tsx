import type { TimelinePart } from '@/lib/event-adapter';
import { JobTimelineError } from './job-timeline-error';
import { JobTimelineMessage } from './job-timeline-message';
import { JobTimelineReasoning } from './job-timeline-reasoning';
import { JobTimelineTool } from './job-timeline-tool';

export type JobTimelineProps = {
  parts: TimelinePart[];
};

export function JobTimeline({ parts }: JobTimelineProps) {
  if (parts.length === 0) {
    return (
      <div className="flex items-center justify-center py-[var(--spacing-66)] text-[var(--text-caption)] text-[var(--color-smoke)]">
        Waiting for events…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-22)]">
      {parts.map((part) => {
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
      })}
    </div>
  );
}
