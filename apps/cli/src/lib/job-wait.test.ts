import { expect, test } from 'bun:test';
import type { EngineClient } from './engine-client.ts';
import { pollWait } from './job-wait.ts';

type WaitInput = { jobId: string; timeoutMs?: number };

function clientWith(wait: (input: WaitInput) => Promise<unknown>) {
	return { jobs: { wait } } as unknown as EngineClient;
}

test('pollWait re-polls while the job is running and returns the terminal result', async () => {
	const responses = [
		{ status: 'running' },
		{ status: 'running' },
		{ status: 'done', sessionId: 's', text: 'finished', stopReason: undefined },
	];
	const inputs: Array<WaitInput> = [];
	const client = clientWith(async (input) => {
		inputs.push(input);
		return responses[inputs.length - 1];
	});

	await expect(pollWait(client, 'job-1')).resolves.toEqual({
		status: 'done',
		sessionId: 's',
		text: 'finished',
		stopReason: undefined,
	});
	expect(inputs).toHaveLength(3);
	expect(inputs[0]).toEqual({ jobId: 'job-1', timeoutMs: 600_000 });
});

test('pollWait returns error results without retrying', async () => {
	let calls = 0;
	const client = clientWith(async () => {
		calls += 1;
		return { status: 'error', message: 'Job not found: job-2' };
	});

	await expect(pollWait(client, 'job-2')).resolves.toEqual({
		status: 'error',
		message: 'Job not found: job-2',
	});
	expect(calls).toBe(1);
});

test('pollWait retries transport failures with backoff', async () => {
	let calls = 0;
	const client = clientWith(async () => {
		calls += 1;
		if (calls === 1) throw new Error('connection reset');
		return { status: 'cancelled' };
	});

	await expect(pollWait(client, 'job-3')).resolves.toEqual({
		status: 'cancelled',
	});
	expect(calls).toBe(2);
});
