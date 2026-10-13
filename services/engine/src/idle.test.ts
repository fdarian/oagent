import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duration, Effect } from 'effect';
import { serveSPA } from './http/spa.ts';
import {
	createIdleTracker,
	IdleExit,
	parseIdleDuration,
	trackResponseBody,
} from './idle.ts';

test('duration shorthand is accepted and invalid durations fail', async () => {
	expect(
		Duration.toMillis(await Effect.runPromise(parseIdleDuration('5s'))),
	).toBe(5000);
	expect(
		Duration.toMillis(await Effect.runPromise(parseIdleDuration('10m'))),
	).toBe(600000);
	await expect(
		Effect.runPromise(parseIdleDuration('invalid')),
	).rejects.toThrow();
	await expect(Effect.runPromise(parseIdleDuration('0s'))).rejects.toThrow();
});

test('idle decisions include requests, jobs, activity and sticky MCP', () => {
	let now = 0;
	const tracker = createIdleTracker(() => now);
	now = 100;
	expect(tracker.shouldExit(100, false)).toBe(true);
	expect(tracker.shouldExit(100, true)).toBe(false);
	const finish = tracker.enter('/jobs/events');
	now = 300;
	expect(tracker.shouldExit(100, false)).toBe(false);
	finish();
	finish();
	expect(tracker.shouldExit(100, false)).toBe(false);
	now = 400;
	expect(tracker.shouldExit(100, false)).toBe(true);
	tracker.enter('/mcp')();
	now = 1000;
	expect(tracker.shouldExit(100, false)).toBe(false);
});

test('disable() permanently turns off idle exit', () => {
	let now = 0;
	const tracker = createIdleTracker(() => now);
	expect(tracker.isActive()).toBe(true);
	tracker.disable();
	now = 1000;
	expect(tracker.isActive()).toBe(false);
	expect(tracker.shouldExit(100, false)).toBe(false);
});

test('IdleExit service reflects the tracker and is inert without one', async () => {
	const tracker = createIdleTracker();
	const service = IdleExit.fromTracker(tracker);
	expect(await Effect.runPromise(service.isActive)).toBe(true);
	await Effect.runPromise(service.disable);
	expect(await Effect.runPromise(service.isActive)).toBe(false);

	const inert = IdleExit.fromTracker(undefined);
	await Effect.runPromise(inert.disable);
	expect(await Effect.runPromise(inert.isActive)).toBe(false);
});

test('tracked SPA asset responses keep their content-type', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'idle-spa-'));
	const asset = join(dir, 'app.js');
	writeFileSync(asset, 'export const x = 1;');
	let finished = 0;
	const server = Bun.serve({
		port: 0,
		fetch: (request) => {
			const response = serveSPA(
				{ '/app.js': asset },
				new URL(request.url).pathname,
			);
			if (response === undefined)
				return new Response('Not Found', { status: 404 });
			return trackResponseBody(response, () => finished++);
		},
	});
	try {
		const response = await fetch(`http://127.0.0.1:${server.port}/app.js`);
		expect(response.headers.get('content-type')).toContain('javascript');
		expect(await response.text()).toBe('export const x = 1;');
		expect(finished).toBe(1);
	} finally {
		await server.stop(true);
		rmSync(dir, { recursive: true });
	}
});
