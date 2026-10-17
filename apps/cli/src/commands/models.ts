import { BACKENDS } from '@oagent/engine';
import { Effect } from 'effect';
import { Command, Flag } from 'effect/cli';
import {
	callEngine,
	connectEngine,
	engineUrlFlag,
	formatFlag,
	renderStructured,
	reportFailure,
	writeStdout,
} from '#/lib/engine-cli.ts';

export const models = Command.make(
	'models',
	{
		backend: Flag.Literals('backend', BACKENDS).pipe(
			Flag.withDescription(
				`Backend whose models to list: ${BACKENDS.join(', ')}.`,
			),
		),
		format: formatFlag,
		engineUrl: engineUrlFlag,
	},
	(options) =>
		Effect.gen(function* () {
			const engine = connectEngine(options.engineUrl);
			const rows = yield* callEngine(engine, (client) =>
				client.models.list({ backend: options.backend }),
			);
			writeStdout(
				renderStructured(
					{ backend: options.backend, models: rows },
					options.format,
				),
			);
		}).pipe(reportFailure({ json: options.format === 'json' })),
).pipe(
	Command.withDescription(
		'List the models a backend offers. Pass `<backend>:<id>` as --model to `session start`.',
	),
);
