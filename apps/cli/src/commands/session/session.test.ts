import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

async function runCli(args: ReadonlyArray<string>) {
	const child = Bun.spawn(
		[
			process.execPath,
			fileURLToPath(new URL('../../index.ts', import.meta.url)),
			...args,
		],
		{ stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
	);
	const outputs = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout: outputs[0], stderr: outputs[1], exitCode: outputs[2] };
}

test('session --help lists every subcommand', async () => {
	const result = await runCli(['session', '--help']);
	expect(result.exitCode).toBe(0);
	for (const name of [
		'start',
		'send',
		'read',
		'cancel',
		'list',
		'models',
		'agents',
		'aliases',
	]) {
		expect(result.stdout).toContain(name);
	}
});

const subcommandFlags: ReadonlyArray<[string, ReadonlyArray<string>]> = [
	[
		'start',
		[
			'--title',
			'--cwd',
			'--model',
			'--agent',
			'--fork',
			'--worktree',
			'--detach',
			'--json',
			'--engine-url',
		],
	],
	['send', ['--detach', '--json', '--engine-url']],
	['read', ['--wait', '--json', '--engine-url']],
	['cancel', ['--json', '--engine-url']],
	['list', ['--cwd', '--all', '--json', '--engine-url']],
	['models', ['--backend', '--format', '--engine-url']],
	['agents', ['--format', '--engine-url']],
	['aliases', ['--format', '--engine-url']],
];

describe('session subcommand help', () => {
	for (const entry of subcommandFlags) {
		test(entry[0], async () => {
			const result = await runCli(['session', entry[0], '--help']);
			expect(result.exitCode).toBe(0);
			for (const flag of entry[1]) {
				expect(result.stdout).toContain(flag);
			}
		});
	}
});

test('session start with empty piped stdin fails before contacting the engine', async () => {
	const result = await runCli([
		'session',
		'start',
		'--engine-url',
		'http://127.0.0.1:9',
	]);
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain('The prompt is empty');
});
