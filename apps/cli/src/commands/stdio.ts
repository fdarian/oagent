import { Command } from '@effect/cli';
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { Engine } from '@oagent/engine';
import { Effect } from 'effect';
import type { Version } from '#/lib/misc';

function runStdio(version: Version) {
	return Effect.gen(function* () {
		const engine = yield* Engine;
		const rt = yield* Effect.runtime<never>();

		const server = new Server(
			{ name: 'oagent', version: version },
			{ capabilities: { tools: {} } },
		);
		engine.mcp.registerTools(server, rt, undefined);

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

export const stdioCmd = (version: Version) =>
	Command.make('stdio', {}, () => runStdio(version));
