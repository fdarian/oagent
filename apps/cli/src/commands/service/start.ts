import { Option } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';
import type { Version } from '#/lib/misc.ts';
import { runServe } from '../serve.ts';
import { portOption } from './shared.ts';

export const start = (version: Version) =>
	Command.make(
		'start',
		{
			port: portOption,
			logFile: Flag.optional(Flag.String('log-file')).pipe(
				Flag.withDescription(
					'Write Effect logs as JSONL to the given file instead of pretty console output',
				),
			),
		},
		(params) =>
			runServe({
				port: params.port,
				portless: false,
				logFile: Option.getOrUndefined(params.logFile),
				version,
			}),
	).pipe(Command.withDescription('Start the oagent HTTP server'));
