import { isAbsolute, resolve } from 'node:path';
import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import {
	callEngine,
	connectEngine,
	engineUrlFlag,
	reportFailure,
} from '#/lib/engine-cli.ts';
import { splitShellWords } from '#/lib/shell-words.ts';
import {
	deriveTitle,
	detachFlag,
	finishStartedTurn,
	jsonFlag,
	readPrompt,
} from './shared.ts';

/**
 * Effect CLI cannot express a flag whose value is optional, so a bare
 * `--worktree` is rewritten to `--worktree=<sentinel>` before parsing. The
 * sentinel contains a NUL, which can never appear in a real argv entry.
 */
export const DEFAULT_WORKTREE_SENTINEL = '\u0000default';

/** Rewrites a bare `--worktree` in `session start` args so it parses as a value. */
export function rewriteBareWorktreeFlag(
	argv: ReadonlyArray<string>,
): Array<string> {
	const rewritten = [...argv];
	if (rewritten[0] !== 'session' || rewritten[1] !== 'start') return rewritten;
	for (let index = 2; index < rewritten.length; index++) {
		const token = rewritten[index];
		if (token === '--') break;
		if (token !== '--worktree') continue;
		const next = rewritten[index + 1];
		if (next === undefined || next.startsWith('-')) {
			rewritten[index] = `--worktree=${DEFAULT_WORKTREE_SENTINEL}`;
		}
	}
	return rewritten;
}

/**
 * The engine may run in another directory than the shell, so a relative path
 * binary is resolved here; bare names stay PATH-resolved by the engine.
 */
export function parseAcpCommand(commandLine: string, cwd = process.cwd()) {
	return Effect.try({
		try: () => {
			const words = splitShellWords(commandLine);
			const binary = words[0];
			if (binary === undefined) {
				throw new Error('--acp needs a command to run.');
			}
			const resolved =
				binary.includes('/') && !isAbsolute(binary)
					? resolve(cwd, binary)
					: binary;
			return { binary: resolved, args: words.slice(1) };
		},
		catch: (cause) =>
			new Error(
				`Invalid --acp command: ${cause instanceof Error ? cause.message : String(cause)}`,
			),
	});
}

function resolveWorktreeRequest(
	worktree: Option.Option<string>,
	base: Option.Option<string>,
) {
	if (Option.isNone(worktree)) {
		return Option.isSome(base)
			? Effect.fail(new Error('--worktree-base-branch requires --worktree.'))
			: Effect.succeed(undefined);
	}
	if (worktree.value === '') {
		return Effect.fail(new Error('--worktree branch name must not be empty.'));
	}
	const baseBranch = Option.getOrUndefined(base);
	return Effect.succeed({
		...(worktree.value === DEFAULT_WORKTREE_SENTINEL
			? {}
			: { branch: worktree.value }),
		...(baseBranch === undefined ? {} : { base: baseBranch }),
	});
}

export const start = Command.make(
	'start',
	{
		prompt: Argument.String('prompt').pipe(Argument.optional),
		title: Flag.String('title').pipe(
			Flag.optional,
			Flag.withDescription(
				'Session title. Defaults to the first non-empty line of the prompt, cut to 60 characters.',
			),
		),
		cwd: Flag.String('cwd').pipe(
			Flag.optional,
			Flag.withDescription(
				'Working directory for the agent (default: the current directory, or the forked session’s directory with --fork).',
			),
		),
		model: Flag.String('model').pipe(
			Flag.optional,
			Flag.withDescription(
				'Model as <alias>[#effort] or <backend>:<modelId>[#effort]. See `oagent aliases` and `oagent models`. With --acp, a bare adapter model id instead (default: the adapter’s current model).',
			),
		),
		acp: Flag.String('acp').pipe(
			Flag.optional,
			Flag.withDescription(
				'Run against an arbitrary ACP agent without saving it, e.g. --acp "bunx my-acp-agent --flag". The command line is split like a shell would (quotes and escapes, nothing expanded or executed). Cannot be combined with --fork.',
			),
		),
		agent: Flag.String('agent').pipe(
			Flag.optional,
			Flag.withDescription('Configured agent type. See `oagent agents`.'),
		),
		fork: Flag.String('fork').pipe(
			Flag.optional,
			Flag.withDescription(
				'Session ID or job ID whose state should be forked.',
			),
		),
		worktree: Flag.String('worktree').pipe(
			Flag.optional,
			Flag.withDescription(
				'Create a fresh worktree for this session. Optional branch name; bare `--worktree` uses the default `oagent/<id>` branch.',
			),
		),
		worktreeBaseBranch: Flag.String('worktree-base-branch').pipe(
			Flag.optional,
			Flag.withDescription(
				'Base branch for the new worktree, replacing the current branch as the {{base}} template variable. Requires --worktree.',
			),
		),
		detach: detachFlag,
		json: jsonFlag,
		engineUrl: engineUrlFlag,
	},
	(options) =>
		Effect.gen(function* () {
			const worktree = yield* resolveWorktreeRequest(
				options.worktree,
				options.worktreeBaseBranch,
			);
			const acp = Option.isSome(options.acp)
				? yield* parseAcpCommand(options.acp.value)
				: undefined;
			if (acp !== undefined && Option.isSome(options.fork)) {
				return yield* Effect.fail(
					new Error('--acp and --fork cannot be used together.'),
				);
			}
			const prompt = yield* readPrompt(options.prompt);
			const engine = connectEngine(options.engineUrl);
			const fork = Option.getOrUndefined(options.fork);
			const cwd =
				Option.getOrUndefined(options.cwd) ??
				// A fork inherits the source session's directory unless told otherwise.
				(fork === undefined ? process.cwd() : undefined);
			const started = yield* callEngine(engine, (client) =>
				client.sessions.start({
					title: Option.getOrUndefined(options.title) ?? deriveTitle(prompt),
					prompt,
					cwd,
					model: Option.getOrUndefined(options.model),
					agent_type: Option.getOrUndefined(options.agent),
					forkId: fork,
					acp,
					worktree,
				}),
			);
			yield* finishStartedTurn({
				engine,
				started,
				detach: options.detach,
				json: options.json,
			});
		}).pipe(reportFailure({ json: options.json })),
).pipe(
	Command.withDescription(
		'Start a coding-agent session (or fork one) and wait for the result. The prompt is the argument, or stdin when piped. Progress goes to stderr; the result goes to stdout.',
	),
);
