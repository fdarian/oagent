import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import type { TimelinePart } from '@/lib/event-adapter';

export type JobTimelineReasoningProps = {
  part: Extract<TimelinePart, { kind: 'reasoning' }>;
};

export function JobTimelineReasoning({ part }: JobTimelineReasoningProps) {
  const durationSeconds =
    part.durationMs !== undefined
      ? Math.ceil(part.durationMs / 1000)
      : undefined;

  return (
    <Reasoning isStreaming={part.isStreaming} duration={durationSeconds}>
      <ReasoningTrigger />
      <ReasoningContent>{part.text}</ReasoningContent>
    </Reasoning>
  );
}
