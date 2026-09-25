import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Engine } from '@oagent/engine';
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import type { Version } from '#/lib/misc';

function runStdio(version: Version) {
	return Effect.gen(function* () {
		const engine = yield* Engine;
		const services = yield* Effect.context<never>();

		yield* Effect.try({
			try: () =>
				serveStdio(() => {
					const server = new McpServer(
						{ name: 'oagent', version },
						{ instructions: engine.mcp.getInstructions() },
					);
					engine.mcp.registerTools(server, services);
					return server;
				}),
			catch: (cause) =>
				new Error(
					`Failed to connect MCP transport: ${cause instanceof Error ? cause.message : String(cause)}`,
				),
		});

		yield* Effect.never;
	}).pipe(Effect.provide(Engine.layer));
}

export const stdioCmd = (version: Version) =>
	Command.make('stdio', {}, () => runStdio(version));
