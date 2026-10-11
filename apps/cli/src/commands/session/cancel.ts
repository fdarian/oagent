import { formatCancellation } from '@oagent/engine';
import { Effect } from 'effect';
import { Argument, Command } from 'effect/cli';
import {
	callEngine,
	connectEngine,
	engineUrlFlag,
	jsonFlag,
	reportFailure,
	writeStdout,
} from './shared.ts';

export const cancel = Command.make(
	'cancel',
	{
		sessionId: Argument.String('sessionId'),
		json: jsonFlag,
		engineUrl: engineUrlFlag,
	},
	(options) =>
		Effect.gen(function* () {
			const engine = connectEngine(options.engineUrl);
			const result = yield* callEngine(engine, (client) =>
				client.sessions.cancel({ sessionId: options.sessionId }),
			);
			if (!result.ok) {
				return yield* Effect.fail(
					new Error(`Session not found: ${options.sessionId}`),
				);
			}
			writeStdout(
				options.json
					? JSON.stringify({
							sessionId: options.sessionId,
							status: result.status,
						})
					: formatCancellation({
							sessionId: options.sessionId,
							status: result.status,
						}),
			);
		}).pipe(
			reportFailure({ json: options.json, sessionId: options.sessionId }),
		),
).pipe(
	Command.withDescription(
		'Cancel the running turn of a session. Does nothing if the session is idle.',
	),
);
