import {
	createRootRoute,
	createRoute,
	createRouter,
} from '@tanstack/react-router';
import { App } from './App.tsx';
import { AliasesPage } from './pages/AliasesPage.tsx';
import { ConsoleIndexPage } from './pages/ConsoleIndexPage.tsx';
import { ConsoleLayout } from './pages/ConsoleLayout.tsx';
import { JobDetailPage } from './pages/JobDetailPage.tsx';

const rootRoute = createRootRoute({ component: App });

const consoleLayoutRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	component: ConsoleLayout,
});

const consoleIndexRoute = createRoute({
	getParentRoute: () => consoleLayoutRoute,
	path: '/',
	component: ConsoleIndexPage,
});

const jobDetailRoute = createRoute({
	getParentRoute: () => consoleLayoutRoute,
	path: 'jobs/$jobId',
	component: JobDetailPage,
});

const aliasesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/aliases',
	component: AliasesPage,
});

const routeTree = rootRoute.addChildren([
	consoleLayoutRoute.addChildren([consoleIndexRoute, jobDetailRoute]),
	aliasesRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}
