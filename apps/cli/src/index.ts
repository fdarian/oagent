#!/usr/bin/env bun
import { Command, Options } from '@effect/cli';
import { BunContext } from '@effect/platform-bun';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, Jobs, OpenCode, registerTools } from '@oagent/engine';
import { Effect, Layer } from 'effect';
import cliPackage from '../package.json' with { type: 'json' };

function runStdio() {
	return Effect.gen(function* () {
		const jobs = yield* Jobs;
		const rt = yield* Effect.runtime<never>();

		const server = new Server(
			{ name: 'oagent', version: cliPackage.version },
			{ capabilities: { tools: {} } },
		);
		registerTools(server, jobs, rt, undefined);

		yield* Effect.tryPromise({
			try: () => server.connect(new StdioServerTransport()),
			catch: (cause) =>
				new Error(
					`Failed to connect MCP transport: ${cause instanceof Error ? cause.message : String(cause)}`,
				),
		});

		yield* Effect.never;
	});
}

function runServe(port: number) {
	return Effect.gen(function* () {
		let filemap: Record<string, string> | undefined;
		const mod = yield* Effect.tryPromise({
			// biome-ignore lint/suspicious/noTsIgnore: generated module missing in dev
			// @ts-ignore Generated at build time; missing in dev
			try: () =>
				import('../.gen/web-ui.gen.ts') as Promise<{
					default?: Record<string, string>;
				}>,
			catch: () => undefined,
		});
		if (mod?.default !== undefined && typeof mod.default === 'object') {
			filemap = mod.default;
		}

		yield* createServer({
			port,
			serverInfo: { name: 'oagent', version: cliPackage.version },
			filemap,
		});
	});
}

const serve = Command.make(
	'serve',
	{
		port: Options.integer('port').pipe(
			Options.withAlias('p'),
			Options.withDefault(17_777),
			Options.withDescription('Port to listen on (default: 17777)'),
		),
	},
	({ port }) => runServe(port),
);

const stdio = Command.make('stdio', {}, () => runStdio());

const cli = Command.make('oagent').pipe(
	Command.withDescription(
		'MCP server that exposes OpenCode to Claude Code as a subagent via ACP',
	),
	Command.withSubcommands([serve, stdio]),
);

const layerMain = Layer.mergeAll(
	Jobs.Default,
	OpenCode.Default,
	BunContext.layer,
).pipe(Layer.provideMerge(Layer.scope));

const program = Command.run(cli, {
	name: 'oagent',
	version: cliPackage.version,
})(process.argv).pipe(Effect.provide(layerMain));

Effect.runPromise(program);
