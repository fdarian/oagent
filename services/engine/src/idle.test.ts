import { expect, test } from 'bun:test';
import { Duration, Effect } from 'effect';
import { createIdleTracker, parseIdleDuration } from './idle.ts';

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
