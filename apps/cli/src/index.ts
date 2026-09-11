#!/usr/bin/env bun
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import cliPackage from '../package.json' with { type: 'json' };
import { claudeCmd } from './commands/claude';
import { doctorCmd } from './commands/doctor';
import { jobsCmd } from './commands/jobs';
import { serveCmd } from './commands/serve';
import { serviceCmd } from './commands/service';
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
		serviceCmd(version),
	]),
);

const program = Command.run({
	version: version,
})(cli);

// Each subcommand provides Engine.layer itself where needed. The `claude mcp serve`
// channel bridge deliberately omits it: it talks to a running engine over HTTP, so
// building the in-process engine here would open the DB and run orphan-recovery,
// wrongly marking the live engine's running jobs as errored.
BunRuntime.runMain()(program.pipe(Effect.provide(BunServices.layer)));
