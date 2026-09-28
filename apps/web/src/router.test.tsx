import { expect, mock, test } from 'bun:test';
import type { EngineRouter } from '@oagent/engine';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { Window } from 'happy-dom';

const window = new Window({
	url: 'http://localhost/jobs/first?sideChat=chat-1',
});
for (const entry of [
	['window', window],
	['self', window],
	['document', window.document],
	['location', window.location],
	['history', window.history],
	['navigator', window.navigator],
	['HTMLElement', window.HTMLElement],
	['customElements', window.customElements],
	['Node', window.Node],
	['scrollTo', () => {}],
	['IS_REACT_ACT_ENVIRONMENT', true],
] as const) {
	Object.defineProperty(globalThis, entry[0], {
		configurable: true,
		value: entry[1],
	});
}
class TestEventSource {
	onmessage?: (event: { data: string }) => void;
	onerror?: () => void;
	constructor(readonly url: string) {}
	close() {}
}
Object.defineProperty(globalThis, 'EventSource', {
	configurable: true,
	value: TestEventSource,
});

const requests: string[] = [];
const client = {
	sideChats: {
		create: async () => ({ id: 'chat' }),
		list: async () => [],
		send: async () => ({ jobId: 'turn' }),
	},
	sessions: {
		get: async () => {
			throw new Error('Destination query unavailable in redirect test');
		},
	},
	jobs: {
		cancel: async () => ({ ok: true }),
		get: async (input: { jobId: string }) => {
			requests.push(input.jobId);
			if (input.jobId === 'unreachable') throw new Error('Engine unavailable');
			return { id: input.jobId, sessionId: 'session-1' };
		},
	},
};
mock.module('./lib/orpc.ts', () => ({
	client,
	orpc: createTanstackQueryUtils(
		client as unknown as RouterClient<EngineRouter>,
	),
	getEngineEndpointURL: (path: string) => `http://localhost${path}`,
}));

const react = await import('react');
const reactDom = await import('react-dom/client');
const reactQuery = await import('@tanstack/react-query');
const reactRouter = await import('@tanstack/react-router');
mock.module('./pages/ConsoleLayout.tsx', () => ({
	ConsoleLayout: () => react.createElement(reactRouter.Outlet),
}));
const { router } = await import('./router.ts');

test('redirects a real job URL to its session without dropping search', async () => {
	const container = document.createElement('div');
	const root = reactDom.createRoot(container);
	const queryClient = new reactQuery.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await react.act(async () => {
		await router.load();
		root.render(
			react.createElement(
				reactQuery.QueryClientProvider,
				{ client: queryClient },
				react.createElement(reactRouter.RouterProvider, { router }),
			),
		);
	});
	await react.act(async () => {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	expect(requests).toEqual(['first']);
	expect(router.state.location.href).toBe(
		'/sessions/session-1?sideChat=chat-1',
	);
	await react.act(async () => {
		await router.navigate({
			to: '/jobs/$jobId',
			params: { jobId: 'unreachable' },
			search: {},
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	expect(router.state.location.href).toBe('/jobs/unreachable');
	expect(container.textContent).toContain(
		"Could not find the job's session: Engine unavailable",
	);
	await react.act(async () => root.unmount());
	queryClient.clear();
});
