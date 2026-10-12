import { Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { pollWait } from '#/lib/job-wait.ts';
import {
	callEngine,
	connectEngine,
	engineUrlFlag,
	jsonFlag,
	renderTurn,
	reportFailure,
	writeStdout,
} from './shared.ts';

export const read = Command.make(
	'read',
	{
		sessionId: Argument.String('sessionId'),
		wait: Flag.Boolean('wait').pipe(
			Flag.withDefault(false),
			Flag.withDescription(
				'If the latest turn is still running, block until it finishes.',
			),
		),
		json: jsonFlag,
		engineUrl: engineUrlFlag,
	},
	(options) =>
		Effect.gen(function* () {
			const engine = connectEngine(options.engineUrl);
			const latest = yield* callEngine(engine, (client) =>
				client.sessions.read({ sessionId: options.sessionId, wait: false }),
			);
			const result =
				options.wait && latest.status === 'running'
					? yield* Effect.tryPromise({
							try: () => pollWait(engine.client, latest.jobId),
							catch: (cause) =>
								cause instanceof Error ? cause : new Error(String(cause)),
						})
					: latest;
			writeStdout(
				renderTurn({
					json: options.json,
					started: { sessionId: options.sessionId, jobId: latest.jobId },
					result,
				}),
			);
		}).pipe(
			reportFailure({ json: options.json, sessionId: options.sessionId }),
		),
).pipe(
	Command.withDescription(
		'Print the latest turn of a session: its status and, once finished, the final message. Use --wait to block until it finishes.',
	),
);
