import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost/' });
Object.defineProperty(globalThis, 'window', {
	configurable: true,
	value: window,
});
Object.defineProperty(globalThis, 'document', {
	configurable: true,
	value: window.document,
});
Object.defineProperty(globalThis, 'location', {
	configurable: true,
	value: window.location,
});
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
	configurable: true,
	value: true,
});

class TestEventSource {
	static sources: TestEventSource[] = [];
	onmessage?: (event: { data: string }) => void;
	onerror?: () => void;
	closed = false;
	constructor(readonly url: string) {
		TestEventSource.sources.push(this);
	}
	close() {
		this.closed = true;
	}
}
Object.defineProperty(globalThis, 'EventSource', {
	configurable: true,
	value: TestEventSource,
});

const react = await import('react');
const reactDom = await import('react-dom/client');
const { useSessionEvents } = await import('./use-session-events.ts');

function Viewer(props: { ids: string[] }) {
	const events = useSessionEvents(props.ids);
	return (
		<div>
			{props.ids
				.map(
					(id) => `${id}:${events[id]?.terminal === true ? 'done' : 'loading'}`,
				)
				.join(',')}
		</div>
	);
}

test('tracks historical jobs independently and closes their event streams', async () => {
	TestEventSource.sources.length = 0;
	const container = document.createElement('div');
	const root = reactDom.createRoot(container);
	await react.act(async () => {
		root.render(<Viewer ids={['first', 'second']} />);
	});
	expect(TestEventSource.sources.map((source) => source.url)).toEqual([
		'http://localhost/jobs/first/events',
		'http://localhost/jobs/second/events',
	]);
	const first = TestEventSource.sources[0];
	if (first === undefined) throw new Error('Expected first event stream');
	await react.act(async () => {
		first.onmessage?.({ data: JSON.stringify('__terminal__') });
	});
	expect(container.textContent).toBe('first:done,second:loading');
	await react.act(async () => {
		root.unmount();
	});
	expect(TestEventSource.sources.every((source) => source.closed)).toBeTrue();
});
