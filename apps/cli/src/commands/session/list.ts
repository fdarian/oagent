import { formatSessions } from '@oagent/engine';
import { Effect, Option } from 'effect';
import { Command, Flag } from 'effect/cli';
import {
	callEngine,
	connectEngine,
	engineUrlFlag,
	reportFailure,
	writeStdout,
} from '#/lib/engine-cli.ts';
import { jsonFlag } from './shared.ts';

export const list = Command.make(
	'list',
	{
		cwd: Flag.String('cwd').pipe(
			Flag.optional,
			Flag.withDescription('Only list sessions started in this directory.'),
		),
		json: jsonFlag,
		engineUrl: engineUrlFlag,
	},
	(options) =>
		Effect.gen(function* () {
			const engine = connectEngine(options.engineUrl);
			const sessions = yield* callEngine(engine, (client) =>
				client.sessions.list({ cwd: Option.getOrUndefined(options.cwd) }),
			);
			writeStdout(
				options.json ? JSON.stringify(sessions) : formatSessions(sessions),
			);
		}).pipe(reportFailure({ json: options.json })),
).pipe(
	Command.withDescription(
		'List recent sessions with their latest job status (running first, then newest first).',
	),
);
