import { Command } from '@effect/cli';
import type { Version } from '#/lib/misc.ts';
import { restart } from './restart.ts';
import { start } from './start.ts';
import { status } from './status.ts';
import { stop } from './stop.ts';

export const serviceCmd = (_version: Version) =>
	Command.make('service').pipe(
		Command.withDescription('Manage the macOS launchd background service'),
		Command.withSubcommands([start, restart, status, stop]),
	);
