import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { ReactNode } from 'react';

const window = new Window({ url: 'http://localhost/' });

function installGlobal(name: PropertyKey, value: unknown) {
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});
}

installGlobal('window', window);
installGlobal('self', window);
installGlobal('document', window.document);
installGlobal('location', window.location);
installGlobal('history', window.history);
installGlobal('navigator', window.navigator);
installGlobal('HTMLElement', window.HTMLElement);
installGlobal('HTMLButtonElement', window.HTMLButtonElement);
installGlobal('Node', window.Node);
installGlobal('Event', window.Event);
installGlobal('MouseEvent', window.MouseEvent);
installGlobal('MutationObserver', window.MutationObserver);
installGlobal('getComputedStyle', window.getComputedStyle.bind(window));
installGlobal(
	'requestAnimationFrame',
	window.requestAnimationFrame.bind(window),
);
installGlobal('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
installGlobal('scrollTo', () => {});
installGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const react = await import('react');
const reactDom = await import('react-dom/client');
const reactQuery = await import('@tanstack/react-query');
const reactRouter = await import('@tanstack/react-router');

type SideChatCreateRequest = {
	sourceJobId: string;
	resolve: (sideChat: { id: string }) => void;
};

const sideChatCreateRequests: SideChatCreateRequest[] = [];
const sideChatListRequests: string[] = [];

mock.module('@/lib/orpc', () => ({
	orpc: {
		jobs: {
			get: async (input: { jobId: string }) => ({
				id: input.jobId,
				status: 'done',
				prompt: `Prompt for ${input.jobId}`,
				cwd: '/repo',
				backend: 'opencode',
				createdAt: 1,
			}),
		},
		sideChats: {
			list: async (input: { sourceJobId: string }) => {
				sideChatListRequests.push(input.sourceJobId);
				return [];
			},
			create: (input: { sourceJobId: string }) => {
				const result = Promise.withResolvers<{ id: string }>();
				sideChatCreateRequests.push({
					sourceJobId: input.sourceJobId,
					resolve: result.resolve,
				});
				return result.promise;
			},
		},
	},
}));

type JobHeaderProps = {
	onNewSideChat?: () => void;
	isCreatingSideChat?: boolean;
};

type JobTimelineProps = {
	header?: ReactNode;
};

type SideChatDrawerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelectSideChat: (sideChatId: string) => void;
};

mock.module('@/components/job-header', () => ({
	JobHeader: (props: JobHeaderProps) =>
		react.createElement(
			'button',
			{
				type: 'button',
				disabled: props.isCreatingSideChat,
				onClick: () => props.onNewSideChat?.(),
			},
			'New side chat',
		),
}));

mock.module('@/components/job-timeline', () => ({
	JobTimeline: (props: JobTimelineProps) =>
		react.createElement('div', undefined, props.header),
}));

mock.module('@/components/job-prompt-view', () => ({
	JobPromptView: () => null,
}));

mock.module('@/components/job-status-strip', () => ({
	JobStatusStrip: () => null,
}));

mock.module('@/components/side-chat-drawer', () => ({
	SideChatDrawer: (props: SideChatDrawerProps) => {
		if (!props.open) return null;
		return react.createElement(
			react.Fragment,
			undefined,
			react.createElement(
				'button',
				{
					type: 'button',
					onClick: () => props.onOpenChange(false),
				},
				'Close side chats',
			),
			react.createElement(
				'button',
				{
					type: 'button',
					onClick: () => props.onSelectSideChat('existing-chat'),
				},
				'Switch side chat',
			),
		);
	},
}));

mock.module('@/lib/use-job-events', () => ({
	useJobEvents: () => ({
		parts: [],
		streamingTail: null,
		terminal: false,
		isLoading: false,
	}),
}));

mock.module('@/lib/use-side-chat-timeline', () => ({
	useSideChatTimeline: () => undefined,
}));

const jobDetailPage = await import('./JobDetailPage.tsx');

type MountedRoute = {
	container: HTMLDivElement;
	navigateToJob: (jobId: string) => Promise<void>;
	navigateAway: () => Promise<void>;
	href: () => string;
	unmount: () => Promise<void>;
};

function RouterOutlet() {
	return react.createElement(reactRouter.Outlet);
}

function AwayPage() {
	return react.createElement('p', undefined, 'Away');
}

async function mountRoute(initialEntry: string): Promise<MountedRoute> {
	const rootRoute = reactRouter.createRootRoute({ component: RouterOutlet });
	const consoleRoute = reactRouter.createRoute({
		getParentRoute: () => rootRoute,
		id: 'console',
		component: RouterOutlet,
	});
	const jobRoute = reactRouter.createRoute({
		getParentRoute: () => consoleRoute,
		path: 'jobs/$jobId',
		component: jobDetailPage.JobDetailPage,
	});
	const awayRoute = reactRouter.createRoute({
		getParentRoute: () => rootRoute,
		path: 'settings',
		component: AwayPage,
	});
	const routeTree = rootRoute.addChildren([
		consoleRoute.addChildren([jobRoute]),
		awayRoute,
	]);
	const history = reactRouter.createMemoryHistory({
		initialEntries: [initialEntry],
	});
	const router = reactRouter.createRouter({ routeTree, history });
	const queryClient = new reactQuery.QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	const container = document.createElement('div');
	document.body.append(container);
	const root = reactDom.createRoot(container);

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

	return {
		container,
		navigateToJob: async (jobId: string) => {
			await react.act(async () => {
				await router.navigate({
					to: '/jobs/$jobId',
					params: { jobId },
				});
			});
		},
		navigateAway: async () => {
			await react.act(async () => {
				await router.navigate({ to: '/settings' });
			});
		},
		href: () => router.state.location.href,
		unmount: async () => {
			await react.act(async () => {
				root.unmount();
			});
			container.remove();
			queryClient.clear();
		},
	};
}

function getButton(
	container: HTMLDivElement,
	label: string,
): HTMLButtonElement {
	const button = Array.from(container.querySelectorAll('button')).find(
		(element) => element.textContent === label,
	);
	if (button === undefined) throw new Error(`${label} button was not found`);
	return button;
}

function getNewSideChatButton(container: HTMLDivElement): HTMLButtonElement {
	return getButton(container, 'New side chat');
}

async function flush() {
	await react.act(async () => {
		await Promise.resolve();
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

async function waitForNewSideChatButton(
	container: HTMLDivElement,
): Promise<HTMLButtonElement> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const button = Array.from(container.querySelectorAll('button')).find(
			(element) => element.textContent === 'New side chat',
		);
		if (button !== undefined) return button;
		await flush();
	}
	return getNewSideChatButton(container);
}

function sideChatListRequestCount(sourceJobId: string): number {
	return sideChatListRequests.filter((jobId) => jobId === sourceJobId).length;
}

async function waitForSideChatListRequestCount(
	sourceJobId: string,
	minimumCount: number,
) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (sideChatListRequestCount(sourceJobId) >= minimumCount) return;
		await flush();
	}
	expect(sideChatListRequestCount(sourceJobId)).toBeGreaterThanOrEqual(
		minimumCount,
	);
}

describe('JobDetailPage side-chat creation lifecycle', () => {
	let activeMountedRoute: MountedRoute | undefined;

	beforeEach(() => {
		sideChatCreateRequests.length = 0;
		sideChatListRequests.length = 0;
		document.body.replaceChildren();
	});

	afterEach(async () => {
		if (activeMountedRoute !== undefined) {
			await activeMountedRoute.unmount();
			activeMountedRoute = undefined;
		}
	});

	test('keeps a delayed job A result from retargeting mounted job B', async () => {
		const mountedRoute = await mountRoute('/jobs/job-a');
		activeMountedRoute = mountedRoute;
		const buttonA = await waitForNewSideChatButton(mountedRoute.container);
		await waitForSideChatListRequestCount('job-a', 1);

		await react.act(async () => {
			buttonA.click();
		});
		expect(sideChatCreateRequests).toHaveLength(1);
		expect(sideChatCreateRequests[0]?.sourceJobId).toBe('job-a');

		await mountedRoute.navigateToJob('job-b');

		const buttonB = await waitForNewSideChatButton(mountedRoute.container);
		await waitForSideChatListRequestCount('job-b', 1);
		expect(buttonB.disabled).toBeFalse();
		await react.act(async () => {
			buttonB.click();
		});
		expect(sideChatCreateRequests).toHaveLength(2);
		expect(sideChatCreateRequests[1]?.sourceJobId).toBe('job-b');

		const jobBCreate = sideChatCreateRequests[1];
		if (jobBCreate === undefined)
			throw new Error('Job B create was not started');
		await react.act(async () => {
			jobBCreate.resolve({ id: 'chat-b' });
			await Promise.resolve();
		});
		await flush();
		expect(mountedRoute.href()).toBe('/jobs/job-b?sideChat=chat-b');

		const jobACreate = sideChatCreateRequests[0];
		if (jobACreate === undefined)
			throw new Error('Job A create was not started');
		const jobAListRequestCount = sideChatListRequestCount('job-a');
		await react.act(async () => {
			jobACreate.resolve({ id: 'chat-a' });
			await Promise.resolve();
		});
		await flush();
		await waitForSideChatListRequestCount('job-a', jobAListRequestCount + 1);
		expect(mountedRoute.href()).toBe('/jobs/job-b?sideChat=chat-b');
	});

	test('refreshes the source query after the originating drawer closes', async () => {
		const mountedRoute = await mountRoute('/jobs/job-a');
		activeMountedRoute = mountedRoute;
		const button = await waitForNewSideChatButton(mountedRoute.container);
		await waitForSideChatListRequestCount('job-a', 1);

		await react.act(async () => {
			button.click();
		});
		const jobACreate = sideChatCreateRequests[0];
		if (jobACreate === undefined)
			throw new Error('Job A create was not started');

		await react.act(async () => {
			getButton(mountedRoute.container, 'Close side chats').click();
		});
		await flush();
		expect(mountedRoute.href()).toBe('/jobs/job-a');

		const jobAListRequestCount = sideChatListRequestCount('job-a');
		await react.act(async () => {
			jobACreate.resolve({ id: 'chat-a' });
			await Promise.resolve();
		});
		await flush();
		await waitForSideChatListRequestCount('job-a', jobAListRequestCount + 1);
		expect(mountedRoute.href()).toBe('/jobs/job-a');
	});

	test('refreshes the source query after switching the originating drawer', async () => {
		const mountedRoute = await mountRoute('/jobs/job-a');
		activeMountedRoute = mountedRoute;
		const button = await waitForNewSideChatButton(mountedRoute.container);
		await waitForSideChatListRequestCount('job-a', 1);

		await react.act(async () => {
			button.click();
		});
		const jobACreate = sideChatCreateRequests[0];
		if (jobACreate === undefined)
			throw new Error('Job A create was not started');

		await react.act(async () => {
			getButton(mountedRoute.container, 'Switch side chat').click();
		});
		await flush();
		expect(mountedRoute.href()).toBe('/jobs/job-a?sideChat=existing-chat');

		const jobAListRequestCount = sideChatListRequestCount('job-a');
		await react.act(async () => {
			jobACreate.resolve({ id: 'chat-a' });
			await Promise.resolve();
		});
		await flush();
		await waitForSideChatListRequestCount('job-a', jobAListRequestCount + 1);
		expect(mountedRoute.href()).toBe('/jobs/job-a?sideChat=existing-chat');
	});

	test('refreshes job A after returning without applying its old selection', async () => {
		const mountedRoute = await mountRoute('/jobs/job-a');
		activeMountedRoute = mountedRoute;
		const buttonA = await waitForNewSideChatButton(mountedRoute.container);
		await waitForSideChatListRequestCount('job-a', 1);

		await react.act(async () => {
			buttonA.click();
		});
		const jobACreate = sideChatCreateRequests[0];
		if (jobACreate === undefined)
			throw new Error('Job A create was not started');

		await mountedRoute.navigateToJob('job-b');
		await waitForNewSideChatButton(mountedRoute.container);
		await waitForSideChatListRequestCount('job-b', 1);
		await mountedRoute.navigateToJob('job-a');
		const returnedButtonA = await waitForNewSideChatButton(
			mountedRoute.container,
		);
		expect(returnedButtonA.disabled).toBeTrue();

		const jobAListRequestCount = sideChatListRequestCount('job-a');
		await react.act(async () => {
			jobACreate.resolve({ id: 'chat-a' });
			await Promise.resolve();
		});
		await flush();
		await waitForSideChatListRequestCount('job-a', jobAListRequestCount + 1);
		expect(mountedRoute.href()).toBe('/jobs/job-a');
	});

	test('ignores a delayed create result after leaving the job route', async () => {
		const mountedRoute = await mountRoute('/jobs/job-a');
		activeMountedRoute = mountedRoute;
		const button = await waitForNewSideChatButton(mountedRoute.container);
		await waitForSideChatListRequestCount('job-a', 1);

		await react.act(async () => {
			button.click();
		});
		const jobACreate = sideChatCreateRequests[0];
		if (jobACreate === undefined)
			throw new Error('Job A create was not started');

		await mountedRoute.navigateAway();
		expect(mountedRoute.container.textContent).toBe('Away');
		const jobAListRequestCount = sideChatListRequestCount('job-a');

		await react.act(async () => {
			jobACreate.resolve({ id: 'chat-a' });
			await Promise.resolve();
		});
		await flush();
		await waitForSideChatListRequestCount('job-a', jobAListRequestCount + 1);
		expect(mountedRoute.href()).toBe('/settings');
	});
});
