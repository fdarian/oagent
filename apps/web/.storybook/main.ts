import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(ts|tsx|mdx)'],
	addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
	framework: {
		name: '@storybook/react-vite',
		options: {},
	},
	typescript: {
		reactDocgen: 'react-docgen',
	},
};

export default config;
