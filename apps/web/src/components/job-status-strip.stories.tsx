import type { Meta, StoryObj } from '@storybook/react-vite';
import { JobStatusStrip } from './job-status-strip';

const meta: Meta<typeof JobStatusStrip> = {
  component: JobStatusStrip,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: {
    status: undefined,
    isRunning: false,
  },
};

export const WorkingWithTool: Story = {
  args: {
    status: 'Running tool: opencode_read_file',
    isRunning: true,
  },
};

export const WorkingWithStatusTextOnly: Story = {
  args: {
    status: 'Analyzing requirements…',
    isRunning: true,
  },
};
