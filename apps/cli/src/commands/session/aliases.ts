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

export const aliases = Command.make(
	'aliases',
	{ format: formatFlag, engineUrl: engineUrlFlag },
	(options) =>
		Effect.gen(function* () {
			const engine = connectEngine(options.engineUrl);
			const rows = yield* callEngine(engine, (client) => client.aliases.list());
			writeStdout(renderStructured({ aliases: rows }, options.format));
		}).pipe(reportFailure({ json: options.format === 'json' })),
).pipe(
	Command.withDescription(
		'List model aliases. Pass a name (optionally with #effort) as --model to `session start`.',
	),
);
