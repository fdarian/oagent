import { describe, expect, test } from 'bun:test';
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from '@tanstack/react-router';
import {
	jobDetailRouteId,
	jobDetailRoutePath,
	jobDetailSearchSchema,
} from './job-detail-route.ts';

function createJobDetailRouter(initialEntry: string) {
	const rootRoute = createRootRoute();
	const consoleRoute = createRoute({
		getParentRoute: () => rootRoute,
		id: 'console',
	});
	const jobDetailRoute = createRoute({
		getParentRoute: () => consoleRoute,
		path: jobDetailRoutePath,
		validateSearch: jobDetailSearchSchema,
	});
	const routeTree = rootRoute.addChildren([
		consoleRoute.addChildren([jobDetailRoute]),
	]);
	const history = createMemoryHistory({ initialEntries: [initialEntry] });
	const router = createRouter({ routeTree, history });

	return { history, router };
}

describe('job detail route query', () => {
	test('routes a reloaded job URL to its persisted side-chat selection', async () => {
		const setup = createJobDetailRouter(
			'/jobs/job-1?engine=http%3A%2F%2Flocalhost%3A17777&sideChat=chat-1',
		);
		await setup.router.load();
		const jobMatch = setup.router.state.matches.find(
			(match) => match.routeId === jobDetailRouteId,
		);

		expect(jobMatch?.params).toEqual({ jobId: 'job-1' });
		expect(jobMatch?.search).toEqual({
			engine: 'http://localhost:17777',
			sideChat: 'chat-1',
		});
	});

	test('restores and closes the selected side-chat through browser history', async () => {
		const setup = createJobDetailRouter(
			'/jobs/job-1?engine=http%3A%2F%2Flocalhost%3A17777&sideChat=chat-1',
		);
		await setup.router.load();
		await setup.router.navigate({
			to: '/jobs/$jobId',
			params: { jobId: 'job-1' },
			search: (previous) => ({ ...previous, sideChat: undefined }),
		});

		expect(setup.router.state.location.href).toBe(
			'/jobs/job-1?engine=http%3A%2F%2Flocalhost%3A17777',
		);

		setup.history.back();
		await setup.router.load();
		expect(setup.router.state.location.href).toBe(
			'/jobs/job-1?engine=http%3A%2F%2Flocalhost%3A17777&sideChat=chat-1',
		);

		setup.history.forward();
		await setup.router.load();
		expect(setup.router.state.location.href).toBe(
			'/jobs/job-1?engine=http%3A%2F%2Flocalhost%3A17777',
		);
	});
});
