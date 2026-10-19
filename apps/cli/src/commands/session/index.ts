import { Command } from 'effect/cli';
import { cancel } from './cancel.ts';
import { history } from './history.ts';
import { list } from './list.ts';
import { result } from './result.ts';
import { send } from './send.ts';
import { start } from './start.ts';

export const sessionCmd = Command.make('session').pipe(
	Command.withDescription(
		'Start, message, get results and history from, and cancel oagent sessions from the command line',
	),
	Command.withSubcommands([start, send, result, history, cancel, list]),
);
