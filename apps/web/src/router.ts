import {
	createRootRoute,
	createRoute,
	createRouter,
	redirect,
} from '@tanstack/react-router';
import { App } from './App.tsx';
import {
	jobDetailRoutePath,
	jobDetailSearchSchema,
} from './lib/job-detail-route.ts';
import { client } from './lib/orpc.ts';
import { AgentsPage } from './pages/AgentsPage.tsx';
import { AliasesPage } from './pages/AliasesPage.tsx';
import { ConsoleIndexPage } from './pages/ConsoleIndexPage.tsx';
import { ConsoleLayout } from './pages/ConsoleLayout.tsx';
import { HarnessSettingsPage } from './pages/HarnessSettingsPage.tsx';
import { SessionPage } from './pages/SessionPage.tsx';
import { SettingsLayout } from './pages/SettingsLayout.tsx';
import { WorktreeSettingsPage } from './pages/WorktreeSettingsPage.tsx';

const rootRoute = createRootRoute({ component: App });

const consoleLayoutRoute = createRoute({
	getParentRoute: () => rootRoute,
	id: 'console',
	component: ConsoleLayout,
});

const consoleIndexRoute = createRoute({
	getParentRoute: () => consoleLayoutRoute,
	path: '/',
	component: ConsoleIndexPage,
});

const jobDetailRoute = createRoute({
	getParentRoute: () => consoleLayoutRoute,
	path: jobDetailRoutePath,
	validateSearch: jobDetailSearchSchema,
	beforeLoad: async ({ params, search }) => {
		const job = await client.jobs.get({ jobId: params.jobId });
		if (job?.sessionId === undefined) throw new Error('Job not found');
		throw redirect({
			to: '/sessions/$sessionId',
			params: { sessionId: job.sessionId },
			search,
			replace: true,
		});
	},
});

const sessionDetailRoute = createRoute({
	getParentRoute: () => consoleLayoutRoute,
	path: 'sessions/$sessionId',
	validateSearch: jobDetailSearchSchema,
	component: SessionPage,
});

const settingsLayoutRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/settings',
	component: SettingsLayout,
});

const settingsIndexRoute = createRoute({
	getParentRoute: () => settingsLayoutRoute,
	path: '/',
	beforeLoad: () => {
		throw redirect({ to: '/settings/aliases' });
	},
});

const settingsAliasesRoute = createRoute({
	getParentRoute: () => settingsLayoutRoute,
	path: 'aliases',
	component: AliasesPage,
});

const settingsAgentsRoute = createRoute({
	getParentRoute: () => settingsLayoutRoute,
	path: 'agents',
	component: AgentsPage,
});

const settingsWorktreeRoute = createRoute({
	getParentRoute: () => settingsLayoutRoute,
	path: 'worktrees',
	component: WorktreeSettingsPage,
});

const settingsHarnessRoute = createRoute({
	getParentRoute: () => settingsLayoutRoute,
	path: 'harnesses/$backend',
	component: HarnessSettingsPage,
});

const routeTree = rootRoute.addChildren([
	consoleLayoutRoute.addChildren([
		consoleIndexRoute,
		jobDetailRoute,
		sessionDetailRoute,
	]),
	settingsLayoutRoute.addChildren([
		settingsIndexRoute,
		settingsAliasesRoute,
		settingsAgentsRoute,
		settingsWorktreeRoute,
		settingsHarnessRoute,
	]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}
