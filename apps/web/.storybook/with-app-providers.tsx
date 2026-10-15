import type { Decorator } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

function StorybookQueryClient(props: { children: ReactNode }) {
	const client = useState(() => new QueryClient())[0];

	return (
		<QueryClientProvider client={client}>{props.children}</QueryClientProvider>
	);
}

export const withAppProviders: Decorator = (Story, context) => (
	<ThemeProvider>
		<StorybookQueryClient key={context.id}>
			<StorybookRouter key={context.id}>
				<Story />
			</StorybookRouter>
		</StorybookQueryClient>
	</ThemeProvider>
);
