import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import {
	callEngine,
	connectEngine,
	deriveTitle,
	detachFlag,
	engineUrlFlag,
	finishStartedTurn,
	jsonFlag,
	readPrompt,
	reportFailure,
} from './shared.ts';

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
				'Model as <alias>[#effort] or <backend>:<modelId>[#effort]. See `oagent session aliases` and `oagent session models`.',
			),
		),
		agent: Flag.String('agent').pipe(
			Flag.optional,
			Flag.withDescription(
				'Configured agent type. See `oagent session agents`.',
			),
		),
		fork: Flag.String('fork').pipe(
			Flag.optional,
			Flag.withDescription(
				'Session ID or job ID whose state should be forked.',
			),
		),
		worktree: Flag.Boolean('worktree').pipe(
			Flag.withDefault(false),
			Flag.withDescription(
				'Create a fresh worktree for this session (requires worktrees to be enabled in oagent settings).',
			),
		),
		detach: detachFlag,
		json: jsonFlag,
		engineUrl: engineUrlFlag,
	},
	(options) =>
		Effect.gen(function* () {
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
					worktree: options.worktree,
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
