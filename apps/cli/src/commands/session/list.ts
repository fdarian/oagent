import { resolve } from 'node:path';
import { formatSessions } from '@oagent/engine';
import { Effect, Option } from 'effect';
import { Command, Flag } from 'effect/cli';
import {
	callEngine,
	connectEngine,
	engineUrlFlag,
	jsonFlag,
	reportFailure,
	writeStdout,
} from './shared.ts';

/** `undefined` means no filter. Relative `--cwd` paths resolve against the shell's directory. */
export function resolveListCwd(input: {
	cwd: string | undefined;
	all: boolean;
	currentDirectory: string;
}): string | undefined {
	if (input.all) {
		if (input.cwd !== undefined) {
			throw new Error('--all and --cwd cannot be used together.');
		}
		return undefined;
	}
	return resolve(input.currentDirectory, input.cwd ?? '.');
}

export const list = Command.make(
	'list',
	{
		cwd: Flag.String('cwd').pipe(
			Flag.optional,
			Flag.withDescription(
				'Only list sessions started or working in this directory or any directory under it (default: the current directory).',
			),
		),
		all: Flag.Boolean('all').pipe(
			Flag.withDefault(false),
			Flag.withDescription(
				'List sessions from every directory. Cannot be combined with --cwd.',
			),
		),
		json: jsonFlag,
		engineUrl: engineUrlFlag,
	},
	(options) =>
		Effect.gen(function* () {
			const cwd = yield* Effect.try({
				try: () =>
					resolveListCwd({
						cwd: Option.getOrUndefined(options.cwd),
						all: options.all,
						currentDirectory: process.cwd(),
					}),
				catch: (cause) =>
					cause instanceof Error ? cause : new Error(String(cause)),
			});
			const engine = connectEngine(options.engineUrl);
			const sessions = yield* callEngine(engine, (client) =>
				client.sessions.list({ cwd }),
			);
			writeStdout(
				options.json ? JSON.stringify(sessions) : formatSessions(sessions),
			);
		}).pipe(reportFailure({ json: options.json })),
).pipe(
	Command.withDescription(
		'List recent sessions under the current directory (or --cwd, or everywhere with --all) with their latest job status (running first, then newest first).',
	),
);
