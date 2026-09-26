import { describe, expect, test } from 'bun:test';
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
} from '@tanstack/react-router';
import { sessionSearchSchema } from './session-route.ts';

function createSessionRouter(initialEntry: string) {
	const rootRoute = createRootRoute();
	const consoleRoute = createRoute({
		getParentRoute: () => rootRoute,
		id: 'console',
	});
	const sessionRoute = createRoute({
		getParentRoute: () => consoleRoute,
		path: 'sessions/$sessionId',
		validateSearch: sessionSearchSchema,
	});
	const routeTree = rootRoute.addChildren([
		consoleRoute.addChildren([sessionRoute]),
	]);
	const history = createMemoryHistory({ initialEntries: [initialEntry] });
	const router = createRouter({ routeTree, history });

	return { history, router };
}

describe('session route query', () => {
	test('routes a reloaded session URL to its persisted side-chat selection', async () => {
		const setup = createSessionRouter(
			'/sessions/session-1?engine=http%3A%2F%2Flocalhost%3A17777&sideChat=chat-1',
		);
		await setup.router.load();
		const sessionMatch = setup.router.state.matches.find(
			(match) => match.routeId === '/console/sessions/$sessionId',
		);

		expect(sessionMatch?.params).toEqual({ sessionId: 'session-1' });
		expect(sessionMatch?.search).toEqual({
			engine: 'http://localhost:17777',
			sideChat: 'chat-1',
		});
	});

	test('restores and closes the selected side-chat through browser history', async () => {
		const setup = createSessionRouter(
			'/sessions/session-1?engine=http%3A%2F%2Flocalhost%3A17777&sideChat=chat-1',
		);
		await setup.router.load();
		await setup.router.navigate({
			to: '/sessions/$sessionId',
			params: { sessionId: 'session-1' },
			search: (previous) => ({ ...previous, sideChat: undefined }),
		});

		expect(setup.router.state.location.href).toBe(
			'/sessions/session-1?engine=http%3A%2F%2Flocalhost%3A17777',
		);

		setup.history.back();
		await setup.router.load();
		expect(setup.router.state.location.href).toBe(
			'/sessions/session-1?engine=http%3A%2F%2Flocalhost%3A17777&sideChat=chat-1',
		);

		setup.history.forward();
		await setup.router.load();
		expect(setup.router.state.location.href).toBe(
			'/sessions/session-1?engine=http%3A%2F%2Flocalhost%3A17777',
		);
	});
});
