import {
	formatHistory,
	HISTORY_DEFAULT_LIMIT,
	HISTORY_MAX_LIMIT,
	HISTORY_MIN_LIMIT,
} from '@oagent/engine';
import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import {
	callEngine,
	connectEngine,
	engineUrlFlag,
	reportFailure,
	writeStdout,
} from '#/lib/engine-cli.ts';
import { jsonFlag } from './shared.ts';

export const history = Command.make(
	'history',
	{
		sessionId: Argument.String('sessionId'),
		job: Flag.String('job').pipe(
			Flag.optional,
			Flag.withDescription(
				'Expand this job into its messages and tool calls instead of listing turns. Cannot be combined with --limit or --before.',
			),
		),
		limit: Flag.Int('limit').pipe(
			Flag.filter(
				(limit) => limit >= HISTORY_MIN_LIMIT && limit <= HISTORY_MAX_LIMIT,
				(limit) =>
					`--limit must be an integer from ${HISTORY_MIN_LIMIT} to ${HISTORY_MAX_LIMIT}, got ${limit}.`,
			),
			Flag.optional,
			Flag.withDescription(
				`How many turns to list, newest first (default ${HISTORY_DEFAULT_LIMIT}, max ${HISTORY_MAX_LIMIT}).`,
			),
		),
		before: Flag.String('before').pipe(
			Flag.optional,
			Flag.withDescription(
				'List the turns older than this job ID (the page hint printed by the previous page).',
			),
		),
		json: jsonFlag,
		engineUrl: engineUrlFlag,
	},
	(options) =>
		Effect.gen(function* () {
			const engine = connectEngine(options.engineUrl);
			const result = yield* callEngine(engine, (client) =>
				client.sessions.history({
					sessionId: options.sessionId,
					jobId: Option.getOrUndefined(options.job),
					limit: Option.getOrUndefined(options.limit),
					before: Option.getOrUndefined(options.before),
				}),
			);
			writeStdout(
				options.json ? JSON.stringify(result) : formatHistory(result),
			);
		}).pipe(
			reportFailure({ json: options.json, sessionId: options.sessionId }),
		),
).pipe(
	Command.withDescription(
		"Print a session's past turns (prompt, final answer, tool-call counts), newest page first. Use --job to expand one turn, including a running one's progress.",
	),
);
