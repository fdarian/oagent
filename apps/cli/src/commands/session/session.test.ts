import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import {
	DEFAULT_WORKTREE_SENTINEL,
	parseAcpCommand,
	rewriteBareWorktreeFlag,
} from './start.ts';

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
	for (const name of ['start', 'send', 'result', 'cancel', 'list']) {
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
			'--acp',
			'--worktree',
			'--worktree-base-branch',
			'--detach',
			'--json',
			'--engine-url',
		],
	],
	['send', ['--detach', '--json', '--engine-url']],
	['result', ['--wait', '--json', '--engine-url']],
	['cancel', ['--json', '--engine-url']],
	['list', ['--cwd', '--all', '--json', '--engine-url']],
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

test('session start rejects --worktree-base-branch without --worktree', async () => {
	const result = await runCli([
		'session',
		'start',
		'--worktree-base-branch',
		'develop',
		'--engine-url',
		'http://127.0.0.1:9',
		'prompt',
	]);
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain('--worktree-base-branch requires --worktree');
});

test('session start parses bare --worktree and --worktree with a branch', async () => {
	for (const worktreeArgs of [['--worktree'], ['--worktree', 'my-branch']]) {
		const result = await runCli([
			'session',
			'start',
			...worktreeArgs,
			'--worktree-base-branch',
			'develop',
			'--engine-url',
			'http://127.0.0.1:9',
		]);
		// Parsing and validation pass; the empty stdin prompt is the first failure.
		expect(result.stderr).toContain('The prompt is empty');
	}
});

describe('rewriteBareWorktreeFlag', () => {
	const sentinel = `--worktree=${DEFAULT_WORKTREE_SENTINEL}`;

	test('rewrites a bare flag at the end', () => {
		expect(rewriteBareWorktreeFlag(['session', 'start', '--worktree'])).toEqual(
			['session', 'start', sentinel],
		);
	});

	test('rewrites a bare flag followed by another flag', () => {
		expect(
			rewriteBareWorktreeFlag([
				'session',
				'start',
				'--worktree',
				'--json',
				'hi',
			]),
		).toEqual(['session', 'start', sentinel, '--json', 'hi']);
	});

	test('leaves a flag with a value untouched', () => {
		const spaced = ['session', 'start', '--worktree', 'my-branch', 'hi'];
		const inline = ['session', 'start', '--worktree=my-branch', 'hi'];
		expect(rewriteBareWorktreeFlag(spaced)).toEqual(spaced);
		expect(rewriteBareWorktreeFlag(inline)).toEqual(inline);
	});

	test('stops scanning at --', () => {
		const args = ['session', 'start', '--', '--worktree'];
		expect(rewriteBareWorktreeFlag(args)).toEqual(args);
	});

	test('never touches --worktree-base-branch', () => {
		const args = ['session', 'start', '--worktree-base-branch'];
		expect(rewriteBareWorktreeFlag(args)).toEqual(args);
	});

	test('leaves other commands untouched', () => {
		const send = ['session', 'send', '--worktree'];
		const jobs = ['jobs', 'list', '--worktree'];
		expect(rewriteBareWorktreeFlag(send)).toEqual(send);
		expect(rewriteBareWorktreeFlag(jobs)).toEqual(jobs);
	});
});

describe('parseAcpCommand', () => {
	test('splits the command line into a binary and arguments', async () => {
		expect(
			await Effect.runPromise(
				parseAcpCommand('bunx my-agent --name "two words"'),
			),
		).toEqual({ binary: 'bunx', args: ['my-agent', '--name', 'two words'] });
		expect(await Effect.runPromise(parseAcpCommand('my-agent'))).toEqual({
			binary: 'my-agent',
			args: [],
		});
	});

	test('resolves a relative binary path against the working directory', async () => {
		expect(
			await Effect.runPromise(
				parseAcpCommand('./bin/agent --flag ./keep', '/work/project'),
			),
		).toEqual({
			binary: '/work/project/bin/agent',
			args: ['--flag', './keep'],
		});
		expect(
			await Effect.runPromise(parseAcpCommand('../agent', '/work/project')),
		).toEqual({ binary: '/work/agent', args: [] });
	});

	test('leaves absolute paths and bare names unchanged', async () => {
		expect(
			await Effect.runPromise(parseAcpCommand('/opt/agent', '/work/project')),
		).toEqual({ binary: '/opt/agent', args: [] });
		expect(
			await Effect.runPromise(parseAcpCommand('opencode', '/work/project')),
		).toEqual({ binary: 'opencode', args: [] });
	});

	test.each(['', '   ', 'agent "unterminated'])('rejects %j', async (input) => {
		await expect(Effect.runPromise(parseAcpCommand(input))).rejects.toThrow(
			/--acp/,
		);
	});
});
