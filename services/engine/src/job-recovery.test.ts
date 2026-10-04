import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { isRunnerAlive, recoveryDecision } from './job-recovery.ts';

const recoverable = {
	runnerAlive: false,
	resumeCount: 0,
	backend: 'opencode',
	interruptedAt: null,
	harnessSessionId: 'ses_test',
	model: 'test',
};

test('live runners are untouched, even at the cap', async () => {
	expect(await Effect.runPromise(isRunnerAlive(process.pid))).toBe(true);
	expect(
		recoveryDecision({ ...recoverable, runnerAlive: true, resumeCount: 3 }),
	).toBe('skip');
});

test('dead runners resume below the cap', async () => {
	const child = Bun.spawn(['true']);
	await child.exited;
	expect(await Effect.runPromise(isRunnerAlive(child.pid))).toBe(false);
	expect(recoveryDecision(recoverable)).toBe('resume');
	expect(recoveryDecision({ ...recoverable, resumeCount: 2 })).toBe('resume');
	expect(recoveryDecision({ ...recoverable, resumeCount: 3 })).toEqual({
		error: 'engine restarted too many times while running',
	});
});

test('Cursor requires a clean interruption', () => {
	expect(recoveryDecision({ ...recoverable, backend: 'cursor' })).toEqual({
		error: 'engine restarted while running',
	});
	expect(
		recoveryDecision({
			...recoverable,
			backend: 'cursor',
			interruptedAt: new Date(),
		}),
	).toBe('resume');
});

test('missing persisted conversation or model cannot resume', () => {
	expect(recoveryDecision({ ...recoverable, harnessSessionId: null })).toEqual({
		error: 'engine restarted without a persisted harness session',
	});
	expect(recoveryDecision({ ...recoverable, model: null })).toEqual({
		error: 'engine restarted without a persisted model',
	});
});
