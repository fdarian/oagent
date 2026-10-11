import { Effect } from 'effect';
import { Command } from 'effect/cli';
import {
	callEngine,
	connectEngine,
	engineUrlFlag,
	formatFlag,
	renderStructured,
	reportFailure,
	writeStdout,
} from './shared.ts';

export const agents = Command.make(
	'agents',
	{ format: formatFlag, engineUrl: engineUrlFlag },
	(options) =>
		Effect.gen(function* () {
			const engine = connectEngine(options.engineUrl);
			const rows = yield* callEngine(engine, (client) => client.agents.list());
			writeStdout(renderStructured({ agents: rows }, options.format));
		}).pipe(reportFailure({ json: options.format === 'json' })),
).pipe(
	Command.withDescription(
		'List configured agent types. Pass a name as --agent to `session start`.',
	),
);
