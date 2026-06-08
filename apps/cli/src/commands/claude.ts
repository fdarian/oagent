import { Command, Options } from '@effect/cli';
import { runChannelServer } from '#/lib/channel.ts';
import { defaultEngineUrl } from '#/lib/engine-client.ts';
import type { Version } from '#/lib/misc.ts';

export const claudeCmd = (version: Version) => {
	const serve = Command.make(
		'serve',
		{
			engineUrl: Options.text('engine-url').pipe(
				Options.withDefault(defaultEngineUrl),
				Options.withDescription(
					'Base URL of the running oagent engine (default: http://localhost:17777 or $OPENCODE_MCP_PORT).',
				),
			),
			mcpName: Options.text('mcp-name').pipe(
				Options.withDefault('oagent'),
				Options.withDescription(
					'MCP server name used for channel source and tool descriptions (default: oagent).',
				),
			),
		},
		({ engineUrl, mcpName }) =>
			runChannelServer({ version, engineUrl, mcpName }),
	).pipe(
		Command.withDescription(
			'Run the dedicated Claude Code channel MCP over stdio, bridging to a running oagent engine and pushing job completions into the session.',
		),
	);

	const mcp = Command.make('mcp').pipe(
		Command.withDescription('Claude Code MCP integrations'),
		Command.withSubcommands([serve]),
	);

	return Command.make('claude').pipe(
		Command.withDescription('Claude Code integrations'),
		Command.withSubcommands([mcp]),
	);
};
