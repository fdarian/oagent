import type { Meta, StoryObj } from '@storybook/react-vite';
import { JobTimelineTool } from './job-timeline-tool';
import type { TimelinePart } from '@/lib/event-adapter';

const meta: Meta<typeof JobTimelineTool> = {
  component: JobTimelineTool,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const InputStreaming: Story = {
  args: {
    part: {
      kind: 'tool',
      id: 'tool-1',
      toolCallId: 'tc-1',
      title: 'write_file',
      state: 'input-streaming',
      body: '{"path": "src/config.ts", "content": "export const config = {"',
      createdAt: Date.now() - 2000,
    } as unknown as TimelinePart & { kind: 'tool' },
  },
};

export const InputAvailable: Story = {
  args: {
    part: {
      kind: 'tool',
      id: 'tool-2',
      toolCallId: 'tc-2',
      title: 'shell',
      state: 'input-available',
      body: '{"command": "git status"}',
      createdAt: Date.now() - 3000,
    } as unknown as TimelinePart & { kind: 'tool' },
  },
};

export const OutputAvailable: Story = {
  args: {
    part: {
      kind: 'tool',
      id: 'tool-3',
      toolCallId: 'tc-3',
      title: 'read_file',
      state: 'output-available',
      body: '{"path": "/etc/hosts", "content": "127.0.0.1 localhost\\n::1 localhost"}',
      createdAt: Date.now() - 5000,
      durationMs: 1200,
    } as unknown as TimelinePart & { kind: 'tool' },
  },
};

export const OutputError: Story = {
  args: {
    part: {
      kind: 'tool',
      id: 'tool-4',
      toolCallId: 'tc-4',
      title: 'shell',
      state: 'output-error',
      body: '{"command": "rm -rf /", "error": "Permission denied"}',
      createdAt: Date.now() - 1000,
      durationMs: 300,
    } as unknown as TimelinePart & { kind: 'tool' },
  },
};
