import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Effect } from 'effect';
import { Settings } from './settings.ts';
import {
	renderWorktreeTemplate,
	resolveWorktreePath,
	validateWorktreeTemplate,
	Worktrees,
} from './worktree.ts';

describe('worktree templates', () => {
	test('accepts known placeholders and quotes substituted shell arguments', () => {
		expect(
			validateWorktreeTemplate(
				'wt switch -c {{branch}} -b {{base}} -- {{repo}}',
			),
		).toBe(true);
		expect(
			renderWorktreeTemplate(
				'wt switch -c {{branch}} -b {{base}} -- {{repo}}',
				{
					branch: "oagent/a'b; echo wrong",
					base: 'main',
					repo: '/project with spaces',
				},
			),
		).toBe(
			"wt switch -c 'oagent/a'\\''b; echo wrong' -b 'main' -- '/project with spaces'",
		);
	});

	test('rejects unknown and malformed placeholders', () => {
		for (const command of [
			'wt {{unknown}}',
			'wt {{branch',
			'wt {{ branch }}',
			'wt {{branch}} }}',
		]) {
			expect(validateWorktreeTemplate(command)).toBe(false);
		}
	});
});

describe('worktree path resolution', () => {
	const listing =
		'worktree /repo\nHEAD deadbeef\nbranch refs/heads/main\n\nworktree /sibling with spaces\nHEAD cafebabe\nbranch refs/heads/oagent/new\n';
	test('matches exact branch and preserves caller subdirectory', () => {
		expect(
			resolveWorktreePath(listing, 'oagent/new', '/repo/apps/web', '/repo'),
		).toBe('/sibling with spaces/apps/web');
		expect(
			resolveWorktreePath(listing, 'oagent/other', '/repo', '/repo'),
		).toBeUndefined();
	});
	test('rejects caller directories outside the repository', () => {
		expect(() =>
			resolveWorktreePath(listing, 'oagent/new', '/elsewhere', '/repo'),
		).toThrow('outside repository');
	});
});

test('creates a worktree and returns the corresponding subdirectory', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oagent-worktree-'));
	const repo = path.join(root, 'repo');
	fs.mkdirSync(path.join(repo, 'apps', 'web'), { recursive: true });
	const git = (args: string[]) => {
		const result = Bun.spawnSync(['git', ...args], { cwd: repo });
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	};
	try {
		git(['init', '-b', 'main']);
		git([
			'-c',
			'user.name=Test',
			'-c',
			'user.email=test@example.invalid',
			'commit',
			'--allow-empty',
			'-m',
			'initial',
		]);
		const worktrees = await Effect.runPromise(
			Worktrees.make.pipe(
				Effect.provideService(Settings, {
					getWorktree: () => ({
						enabled: true,
						createCommand: 'git worktree add -b {{branch}} ../created',
					}),
				} as Settings['Service']),
			),
		);
		const created = await Effect.runPromise(
			worktrees.create(path.join(repo, 'apps', 'web'), 'oagent/test'),
		);
		expect(created).toBe(
			path.join(fs.realpathSync(root), 'created', 'apps', 'web'),
		);
		expect(fs.existsSync(path.join(root, 'created', '.git'))).toBe(true);
		const duplicate = await Effect.runPromise(
			Effect.flip(worktrees.create(repo, 'oagent/test')),
		);
		expect(duplicate.stderr).toContain('already exists');
		expect(duplicate.message).toContain('Create worktree exited with code');
		const outside = await Effect.runPromise(
			Effect.flip(worktrees.create(root, 'oagent/outside')),
		);
		expect(outside.message).toContain('not a git repository');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('uses the requested base instead of the current branch', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oagent-worktree-base-'));
	const repo = path.join(root, 'repo');
	fs.mkdirSync(repo, { recursive: true });
	const git = (args: string[]) => {
		const result = Bun.spawnSync(
			[
				'git',
				'-c',
				'user.name=Test',
				'-c',
				'user.email=test@example.invalid',
				...args,
			],
			{ cwd: repo },
		);
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout.toString().trim();
	};
	try {
		git(['init', '-b', 'main']);
		git(['commit', '--allow-empty', '-m', 'initial']);
		git(['switch', '-c', 'feature']);
		git(['commit', '--allow-empty', '-m', 'feature work']);
		const featureHead = git(['rev-parse', 'HEAD']);
		git(['switch', 'main']);
		const worktrees = await Effect.runPromise(
			Worktrees.make.pipe(
				Effect.provideService(Settings, {
					getWorktree: () => ({
						enabled: true,
						createCommand: 'git worktree add -b {{branch}} ../created {{base}}',
					}),
				} as Settings['Service']),
			),
		);
		await Effect.runPromise(worktrees.create(repo, 'oagent/based', 'feature'));
		const created = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], {
			cwd: path.join(root, 'created'),
		});
		expect(created.stdout.toString().trim()).toBe(featureHead);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('ensureEnabled fails with a clear error when worktrees are disabled', async () => {
	const worktrees = await Effect.runPromise(
		Worktrees.make.pipe(
			Effect.provideService(Settings, {
				getWorktree: () => ({ enabled: false, createCommand: '' }),
			} as Settings['Service']),
		),
	);
	const error = await Effect.runPromise(Effect.flip(worktrees.ensureEnabled()));
	expect(error._tag).toBe('WorktreeError');
	expect(error.message).toContain('Worktrees are disabled');
	const createError = await Effect.runPromise(
		Effect.flip(worktrees.create('/tmp', 'oagent/x')),
	);
	expect(createError.message).toBe(error.message);
});
