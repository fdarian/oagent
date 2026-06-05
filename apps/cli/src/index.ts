#!/usr/bin/env bun
import { Command } from '@effect/cli';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import cliPackage from '../package.json' with { type: 'json' };
import { claudeCmd } from './commands/claude';
import { doctorCmd } from './commands/doctor';
import { jobsCmd } from './commands/jobs';
import { serveCmd } from './commands/serve';
import { stdioCmd } from './commands/stdio';
import type { Version } from './lib/misc';

const version: Version = cliPackage.version;

const cli = Command.make('oagent').pipe(
	Command.withDescription(
		'MCP server that exposes OpenCode to Claude Code as a subagent via ACP',
	),
	Command.withSubcommands([
		serveCmd(version),
		stdioCmd(version),
		claudeCmd(version),
		jobsCmd(version),
		doctorCmd(version),
	]),
);

const program = Command.run(cli, {
	name: 'oagent',
	version: version,
})(process.argv);

// Each subcommand provides Engine.layer itself where needed. The `claude mcp serve`
// channel bridge deliberately omits it: it talks to a running engine over HTTP, so
// building the in-process engine here would open the DB and run orphan-recovery,
// wrongly marking the live engine's running jobs as errored.
program.pipe(Effect.provide(BunContext.layer), (e) => BunRuntime.runMain(e));
