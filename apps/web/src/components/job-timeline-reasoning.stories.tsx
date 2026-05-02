import type { Meta, StoryObj } from '@storybook/react-vite';
import { JobTimelineReasoning } from './job-timeline-reasoning';
import type { TimelinePart } from '@/lib/event-adapter';

const meta: Meta<typeof JobTimelineReasoning> = {
  component: JobTimelineReasoning,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Streaming: Story = {
  args: {
    part: {
      kind: 'reasoning',
      id: 'reasoning-1',
      text: 'Let me analyze the codebase structure first...',
      isStreaming: true,
      createdAt: Date.now() - 2000,
    } as TimelinePart & { kind: 'reasoning' },
  },
};

export const Finished: Story = {
  args: {
    part: {
      kind: 'reasoning',
      id: 'reasoning-2',
      text: 'The best approach is to extract the common logic into a shared utility. This reduces duplication and makes testing easier.',
      isStreaming: false,
      createdAt: Date.now() - 8000,
      durationMs: 5200,
    } as TimelinePart & { kind: 'reasoning' },
  },
};
