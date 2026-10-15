import { Effect } from 'effect';
import { Argument, Command } from 'effect/cli';
import {
	callEngine,
	connectEngine,
	engineUrlFlag,
	reportFailure,
} from '#/lib/engine-cli.ts';
import {
	detachFlag,
	finishStartedTurn,
	jsonFlag,
	readPrompt,
} from './shared.ts';

export const send = Command.make(
	'send',
	{
		sessionId: Argument.String('sessionId'),
		prompt: Argument.String('prompt').pipe(Argument.optional),
		detach: detachFlag,
		json: jsonFlag,
		engineUrl: engineUrlFlag,
	},
	(options) =>
		Effect.gen(function* () {
			const prompt = yield* readPrompt(options.prompt);
			const engine = connectEngine(options.engineUrl);
			const started = yield* callEngine(engine, (client) =>
				client.sessions.sendMessage({ sessionId: options.sessionId, prompt }),
			);
			yield* finishStartedTurn({
				engine,
				started,
				detach: options.detach,
				json: options.json,
			});
		}).pipe(
			reportFailure({ json: options.json, sessionId: options.sessionId }),
		),
).pipe(
	Command.withDescription(
		'Send a message to a session. If a turn is running the message is queued for the next step boundary (supported on OpenCode and Claude; other backends reject the send while a turn is running); otherwise a new turn starts and is awaited. The prompt is the argument, or stdin when piped.',
	),
);
