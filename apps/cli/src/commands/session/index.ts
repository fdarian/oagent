import { Command } from 'effect/cli';
import type { Version } from '#/lib/misc.ts';
import { agents } from './agents.ts';
import { aliases } from './aliases.ts';
import { cancel } from './cancel.ts';
import { list } from './list.ts';
import { models } from './models.ts';
import { read } from './read.ts';
import { send } from './send.ts';
import { start } from './start.ts';

export const sessionCmd = (_version: Version) =>
	Command.make('session').pipe(
		Command.withDescription(
			'Start, message, read and cancel oagent sessions from the command line',
		),
		Command.withSubcommands([
			start,
			send,
			read,
			cancel,
			list,
			models,
			agents,
			aliases,
		]),
	);
