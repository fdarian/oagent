import type { TimelinePart } from '@/lib/event-adapter';

export type JobTimelineToolProps = {
  part: Extract<TimelinePart, { kind: 'tool' }>;
};

export function JobTimelineTool(_props: JobTimelineToolProps) {
  return <div />;
}
