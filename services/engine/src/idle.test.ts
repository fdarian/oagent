import { expect, test } from 'bun:test';
import { createIdleTracker } from './idle.ts';

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
