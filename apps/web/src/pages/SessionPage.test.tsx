import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EngineRouter } from '@oagent/engine';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
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

const fakeClient = {
	sessions: {
		get: async (input: { sessionId: string }) => ({
			id: input.sessionId,
			title:
				input.sessionId === 'session-1'
					? 'Conversation'
					: `Title for ${input.sessionId}`,
			cwd: '/repo',
			createdAt: 1,
			status: 'done',
			jobs:
				input.sessionId === 'session-1'
					? [
							{
								id: 'first',
								title: 'Conversation',
								prompt: 'First prompt',
								createdAt: 1,
								status: 'done',
								cwd: '/repo',
								backend: 'opencode',
								sessionId: input.sessionId,
							},
							{
								id: 'second',
								title: 'Conversation',
								prompt: 'Follow-up prompt',
								createdAt: 2,
								status: 'done',
								cwd: '/repo',
								backend: 'opencode',
								sessionId: input.sessionId,
							},
						]
					: [
							{
								id: input.sessionId,
								title: `Title for ${input.sessionId}`,
								prompt: `Prompt for ${input.sessionId}`,
								createdAt: 1,
								status: 'done',
								cwd: '/repo',
								backend: 'opencode',
								sessionId: input.sessionId,
							},
						],
		}),
	},
	jobs: {
		cancel: async () => ({ ok: true }),
	},
	sideChats: {
		list: async (input: { sourceJobId: string }) => {
			if (input.sourceJobId === undefined)
				throw new Error('Missing source job id');
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
		send: async () => ({ jobId: 'turn-job' }),
	},
};
const orpc = createTanstackQueryUtils(
	fakeClient as unknown as RouterClient<EngineRouter>,
);

mock.module('@/lib/orpc', () => ({ orpc, client: fakeClient }));

type JobHeaderProps = {
	title: string;
	onNewSideChat?: () => void;
	isCreatingSideChat?: boolean;
};

type JobTimelineProps = {
	header?: ReactNode;
	parts?: Array<{ kind: string; text?: string }>;
};

type SideChatDrawerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelectSideChat: (sideChatId: string) => void;
};

mock.module('@/components/job-header', () => ({
	JobHeader: (props: JobHeaderProps) =>
		react.createElement(
			react.Fragment,
			undefined,
			react.createElement('span', undefined, props.title),
			react.createElement(
				'button',
				{
					type: 'button',
					disabled: props.isCreatingSideChat,
					onClick: () => props.onNewSideChat?.(),
				},
				'New side chat',
			),
		),
}));

mock.module('@/components/job-timeline', () => ({
	JobTimeline: (props: JobTimelineProps) =>
		react.createElement(
			'div',
			undefined,
			props.header,
			...(props.parts ?? [])
				.filter((part) => part.kind === 'user' || part.kind === 'text')
				.map((part) =>
					react.createElement(
						'p',
						{ 'data-kind': part.kind, key: part.text },
						part.text,
					),
				),
		),
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

const eventStates = new Map<
	string,
	{
		jobId: string;
		parts: Array<{ kind: 'text'; id: string; text: string; createdAt: number }>;
		streamingTail: null;
		children: Map<string, never>;
		terminal: boolean;
		isLoading: boolean;
	}
>();
mock.module('@/lib/use-job-events', () => ({
	useJobEvents: (jobId: string) => {
		const existing = eventStates.get(jobId);
		if (existing !== undefined) return existing;
		const state = {
			jobId,
			parts: [] as Array<{
				kind: 'text';
				id: string;
				text: string;
				createdAt: number;
			}>,
			streamingTail: null,
			children: new Map<string, never>(),
			terminal: false,
			isLoading: false,
		};
		eventStates.set(jobId, state);
		return state;
	},
}));

mock.module('@/lib/use-session-events', () => ({
	useSessionEvents: (ids: string[]) =>
		Object.fromEntries(ids.map((id) => [id, eventStates.get(id)])),
}));

mock.module('@/lib/use-side-chat-timeline', () => ({
	useSideChatTimeline: () => undefined,
}));

const sessionPage = await import('./SessionPage.tsx');

type MountedRoute = {
	container: HTMLDivElement;
	navigateToSession: (sessionId: string) => Promise<void>;
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
	const sessionRoute = reactRouter.createRoute({
		getParentRoute: () => consoleRoute,
		path: 'sessions/$sessionId',
		component: sessionPage.SessionPage,
	});
	const awayRoute = reactRouter.createRoute({
		getParentRoute: () => rootRoute,
		path: 'settings',
		component: AwayPage,
	});
	const routeTree = rootRoute.addChildren([
		consoleRoute.addChildren([sessionRoute]),
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
		navigateToSession: async (sessionId: string) => {
			await react.act(async () => {
				await router.navigate({
					to: '/sessions/$sessionId',
					params: { sessionId },
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

describe('SessionPage side-chat creation lifecycle', () => {
	let activeMountedRoute: MountedRoute | undefined;

	beforeEach(() => {
		eventStates.clear();
		sideChatCreateRequests.length = 0;
		sideChatListRequests.length = 0;
		document.body.replaceChildren();
	});

	test('shows the session title and initial prompt as a user message', async () => {
		const mountedRoute = await mountRoute('/sessions/job-title');
		activeMountedRoute = mountedRoute;
		await waitForNewSideChatButton(mountedRoute.container);

		expect(mountedRoute.container.textContent).toContain('Title for job-title');
		expect(
			mountedRoute.container.querySelector('[data-kind="user"]')?.textContent,
		).toBe('Prompt for job-title');
	});

	test('shows each session turn prompt in order in one timeline', async () => {
		eventStates.set('first', {
			jobId: 'first',
			parts: [
				{ kind: 'text', id: 'answer', text: 'First answer', createdAt: 1 },
			],
			streamingTail: null,
			children: new Map<string, never>(),
			terminal: true,
			isLoading: false,
		});
		const mountedRoute = await mountRoute('/sessions/session-1');
		activeMountedRoute = mountedRoute;
		await waitForNewSideChatButton(mountedRoute.container);
		const prompts = Array.from(
			mountedRoute.container.querySelectorAll('[data-kind="user"]'),
		).map((element) => element.textContent);
		expect(prompts).toEqual(['First prompt', 'Follow-up prompt']);
		const messages = Array.from(
			mountedRoute.container.querySelectorAll('[data-kind]'),
		).map((element) => element.textContent);
		expect(messages).toEqual([
			'First prompt',
			'First answer',
			'Follow-up prompt',
		]);
		expect(mountedRoute.container.textContent).toContain('Conversation');
	});

	afterEach(async () => {
		if (activeMountedRoute !== undefined) {
			await activeMountedRoute.unmount();
			activeMountedRoute = undefined;
		}
	});

	test('keeps a delayed job A result from retargeting mounted job B', async () => {
		const mountedRoute = await mountRoute('/sessions/job-a');
		activeMountedRoute = mountedRoute;
		const buttonA = await waitForNewSideChatButton(mountedRoute.container);
		await waitForSideChatListRequestCount('job-a', 1);

		await react.act(async () => {
			buttonA.click();
		});
		expect(sideChatCreateRequests).toHaveLength(1);
		expect(sideChatCreateRequests[0]?.sourceJobId).toBe('job-a');

		await mountedRoute.navigateToSession('job-b');

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
		expect(mountedRoute.href()).toBe('/sessions/job-b?sideChat=chat-b');

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
		expect(mountedRoute.href()).toBe('/sessions/job-b?sideChat=chat-b');
	});

	test('refreshes the source query after the originating drawer closes', async () => {
		const mountedRoute = await mountRoute('/sessions/job-a');
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
		expect(mountedRoute.href()).toBe('/sessions/job-a');

		const jobAListRequestCount = sideChatListRequestCount('job-a');
		await react.act(async () => {
			jobACreate.resolve({ id: 'chat-a' });
			await Promise.resolve();
		});
		await flush();
		await waitForSideChatListRequestCount('job-a', jobAListRequestCount + 1);
		expect(mountedRoute.href()).toBe('/sessions/job-a');
	});

	test('refreshes the source query after switching the originating drawer', async () => {
		const mountedRoute = await mountRoute('/sessions/job-a');
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
		expect(mountedRoute.href()).toBe('/sessions/job-a?sideChat=existing-chat');

		const jobAListRequestCount = sideChatListRequestCount('job-a');
		await react.act(async () => {
			jobACreate.resolve({ id: 'chat-a' });
			await Promise.resolve();
		});
		await flush();
		await waitForSideChatListRequestCount('job-a', jobAListRequestCount + 1);
		expect(mountedRoute.href()).toBe('/sessions/job-a?sideChat=existing-chat');
	});

	test('refreshes job A after returning without applying its old selection', async () => {
		const mountedRoute = await mountRoute('/sessions/job-a');
		activeMountedRoute = mountedRoute;
		const buttonA = await waitForNewSideChatButton(mountedRoute.container);
		await waitForSideChatListRequestCount('job-a', 1);

		await react.act(async () => {
			buttonA.click();
		});
		const jobACreate = sideChatCreateRequests[0];
		if (jobACreate === undefined)
			throw new Error('Job A create was not started');

		await mountedRoute.navigateToSession('job-b');
		await waitForNewSideChatButton(mountedRoute.container);
		await waitForSideChatListRequestCount('job-b', 1);
		await mountedRoute.navigateToSession('job-a');
		const returnedButtonA = await waitForNewSideChatButton(
			mountedRoute.container,
		);
		await flush();
		expect(returnedButtonA.disabled).toBeTrue();

		const jobAListRequestCount = sideChatListRequestCount('job-a');
		await react.act(async () => {
			jobACreate.resolve({ id: 'chat-a' });
			await Promise.resolve();
		});
		await flush();
		await waitForSideChatListRequestCount('job-a', jobAListRequestCount + 1);
		expect(mountedRoute.href()).toBe('/sessions/job-a');
	});

	test('ignores a delayed create result after leaving the session route', async () => {
		const mountedRoute = await mountRoute('/sessions/job-a');
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
