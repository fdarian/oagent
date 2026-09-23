/// <reference types="bun" />

import fs from 'node:fs';
import path from 'node:path';
import { Context, Effect, Layer, Schema } from 'effect';
import { Settings } from './settings.ts';

export const WORKTREE_VARIABLES = ['branch', 'base', 'repo'] as const;
const COMMAND_TIMEOUT_MS = 60_000;

export function validateWorktreeTemplate(command: string): boolean {
	const references = Array.from(
		command.matchAll(/\{\{.*?\}\}/g),
		(match) => match[0],
	);
	const remainder = command.replace(/\{\{.*?\}\}/g, '');
	return (
		!remainder.includes('{{') &&
		!remainder.includes('}}') &&
		references.every((reference) =>
			WORKTREE_VARIABLES.some((name) => reference === `{{${name}}}`),
		)
	);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function renderWorktreeTemplate(
	command: string,
	values: { branch: string; base: string; repo: string },
): string {
	if (!validateWorktreeTemplate(command)) {
		throw new Error('Unknown or malformed worktree template variable');
	}
	return command.replace(/\{\{(branch|base|repo)\}\}/g, (_, name: string) => {
		if (name === 'branch') return shellQuote(values.branch);
		if (name === 'base') return shellQuote(values.base);
		return shellQuote(values.repo);
	});
}

export function resolveWorktreePath(
	listing: string,
	branch: string,
	callerCwd: string,
	repo: string,
): string | undefined {
	const relative = path.relative(repo, callerCwd);
	if (
		relative === '..' ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new Error(`Working directory is outside repository: ${callerCwd}`);
	}
	const entry = listing
		.split(/\r?\n\r?\n/)
		.find((block) =>
			block.split(/\r?\n/).includes(`branch refs/heads/${branch}`),
		);
	const worktree = entry
		?.split(/\r?\n/)
		.find((line) => line.startsWith('worktree '));
	return worktree === undefined
		? undefined
		: path.join(worktree.slice('worktree '.length), relative);
}

export class WorktreeError extends Schema.TaggedError<WorktreeError>()(
	'WorktreeError',
	{ message: Schema.String, stderr: Schema.optional(Schema.String) },
) {}

function runCommand(args: string[], cwd: string, operation: string) {
	return Effect.scoped(
		Effect.gen(function* () {
			const child = yield* Effect.acquireRelease(
				Effect.try({
					try: () =>
						Bun.spawn(args, {
							cwd,
							stdin: 'ignore',
							stdout: 'pipe',
							stderr: 'pipe',
						}),
					catch: (cause) =>
						new WorktreeError({
							message: `${operation}: ${String(cause)}`,
						}),
				}),
				(process) =>
					Effect.sync(() => {
						if (process.exitCode === null) process.kill();
					}),
			);
			const result = yield* Effect.tryPromise({
				try: () =>
					Promise.all([
						new Response(child.stdout).text(),
						new Response(child.stderr).text(),
						child.exited,
					]),
				catch: (cause) =>
					new WorktreeError({
						message: `${operation}: ${String(cause)}`,
					}),
			});
			if (result[2] !== 0) {
				return yield* new WorktreeError({
					message: `${operation} exited with code ${result[2]}: ${result[1].trim() || result[0].trim()}`,
					stderr: result[1],
				});
			}
			return result[0].trim();
		}),
	).pipe(
		Effect.timeout(COMMAND_TIMEOUT_MS),
		Effect.mapError((cause) =>
			cause instanceof WorktreeError
				? cause
				: new WorktreeError({
						message: `${operation} timed out after ${COMMAND_TIMEOUT_MS}ms`,
					}),
		),
	);
}

export class Worktrees extends Context.Service<Worktrees>()(
	'oagent/Worktrees',
	{
		make: Effect.gen(function* () {
			const settings = yield* Settings;
			return {
				create: (cwd: string, branch: string) =>
					Effect.gen(function* () {
						const config = settings.getWorktree();
						if (!config.enabled || config.createCommand.trim() === '') {
							return yield* new WorktreeError({
								message: 'Worktrees are not enabled or configured.',
							});
						}
						const repo = yield* runCommand(
							['git', 'rev-parse', '--show-toplevel'],
							cwd,
							'Find git repository',
						);
						const base = yield* runCommand(
							['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
							cwd,
							'Find current branch',
						);
						const command = yield* Effect.try({
							try: () =>
								renderWorktreeTemplate(config.createCommand, {
									branch,
									base,
									repo,
								}),
							catch: (cause) => new WorktreeError({ message: String(cause) }),
						});
						yield* runCommand(['sh', '-c', command], repo, 'Create worktree');
						const listing = yield* runCommand(
							['git', 'worktree', 'list', '--porcelain'],
							repo,
							'List worktrees',
						);
						const canonicalCwd = yield* Effect.try({
							try: () => fs.realpathSync(cwd),
							catch: (cause) =>
								new WorktreeError({
									message: `Could not resolve working directory ${cwd}: ${String(cause)}`,
								}),
						});
						const resolved = yield* Effect.try({
							try: () =>
								resolveWorktreePath(listing, branch, canonicalCwd, repo),
							catch: (cause) => new WorktreeError({ message: String(cause) }),
						});
						if (resolved === undefined) {
							return yield* new WorktreeError({
								message: `Created worktree for branch ${branch} was not found in git worktree list.`,
							});
						}
						yield* Effect.try({
							try: () => fs.mkdirSync(resolved, { recursive: true }),
							catch: (cause) =>
								new WorktreeError({
									message: `Could not prepare worktree directory ${resolved}: ${String(cause)}`,
								}),
						});
						return resolved;
					}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(Worktrees, Worktrees.make).pipe(
		Layer.provide(Settings.layer),
	);
}
