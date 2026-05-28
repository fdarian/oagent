import {
	createRootRoute,
	createRoute,
	createRouter,
} from '@tanstack/react-router';
import { App } from './App.tsx';
import { AliasesPage } from './pages/AliasesPage.tsx';
import { ConsolePage } from './pages/ConsolePage.tsx';

const rootRoute = createRootRoute({ component: App });

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	component: ConsolePage,
});

const aliasesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/aliases',
	component: AliasesPage,
});

const routeTree = rootRoute.addChildren([indexRoute, aliasesRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}
