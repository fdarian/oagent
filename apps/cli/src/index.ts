#!/usr/bin/env bun
import { Command } from '@effect/cli';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Engine } from '@oagent/engine';
import { Effect, Layer } from 'effect';
import cliPackage from '../package.json' with { type: 'json' };
import { serveCmd } from './commands/serve';
import { stdioCmd } from './commands/stdio';
import type { Version } from './lib/misc';

const version: Version = cliPackage.version;

const cli = Command.make('oagent').pipe(
	Command.withDescription(
		'MCP server that exposes OpenCode to Claude Code as a subagent via ACP',
	),
	Command.withSubcommands([serveCmd(version), stdioCmd(version)]),
);

const program = Command.run(cli, {
	name: 'oagent',
	version: version,
})(process.argv);

program.pipe(
	Effect.provide(Engine.layer.pipe(Layer.provideMerge(BunContext.layer))),
	(e) => BunRuntime.runMain(e),
);
