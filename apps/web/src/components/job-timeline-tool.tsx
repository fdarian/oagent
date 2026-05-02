import {
  Tool,
  ToolContent,
  ToolHeader,
} from '@/components/ai-elements/tool';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { detectLanguage } from '@/lib/detect-language';
import type { TimelinePart } from '@/lib/event-adapter';

export type JobTimelineToolProps = {
  part: Extract<TimelinePart, { kind: 'tool' }>;
};

export function JobTimelineTool({ part }: JobTimelineToolProps) {
  const language = detectLanguage(part.body);
  const defaultOpen = part.state === 'input-streaming' || part.state === 'input-available';

  return (
    <Tool defaultOpen={defaultOpen}>
      <ToolHeader
        type="tool-invocation"
        state={part.state}
        title={part.title}
      />
      <ToolContent>
        <CodeBlock code={part.body} language={language} />
      </ToolContent>
    </Tool>
  );
}
