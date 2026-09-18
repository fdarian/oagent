import type { Decorator } from '@storybook/react-vite';
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterContextProvider,
} from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ThemeProvider } from '../src/lib/theme';

type StorybookRouterProps = {
	children: ReactNode;
};

function StorybookRouter(props: StorybookRouterProps) {
	const router = useState(() =>
		createRouter({
			routeTree: createRootRoute(),
			history: createMemoryHistory({ initialEntries: ['/'] }),
			isServer: false,
		}),
	)[0];

	return (
		<RouterContextProvider router={router}>
			{props.children}
		</RouterContextProvider>
	);
}

export const withAppProviders: Decorator = (Story, context) => (
	<ThemeProvider>
		<StorybookRouter key={context.id}>
			<Story />
		</StorybookRouter>
	</ThemeProvider>
);
