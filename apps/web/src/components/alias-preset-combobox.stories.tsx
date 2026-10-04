import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AliasPresetCombobox } from './alias-preset-combobox';

const meta: Meta<typeof AliasPresetCombobox> = {
	component: AliasPresetCombobox,
	args: {
		presets: [
			{ id: 'first', name: 'Everyday' },
			{ id: 'second', name: 'Research' },
		],
		active: null,
		disabled: false,
		onCreate: fn(),
		onActivate: fn(),
	},
};
export default meta;
type Story = StoryObj<typeof meta>;
export const NoPreset: Story = {};
export const NoPresets: Story = { args: { presets: [] } };
export const Active: Story = {
	args: { active: { id: 'first', name: 'Everyday' } },
};
