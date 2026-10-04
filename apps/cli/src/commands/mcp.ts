import { Effect, Option } from 'effect';
import { Command, Flag } from 'effect/unstable/cli';
import { defaultEngineUrl } from '../lib/engine-client.ts';
import { parseAgents, parseAliases } from '../lib/ephemeral-config.ts';
import { runMcpStdio } from '../lib/mcp-stdio.ts';
import type { Version } from '../lib/misc.ts';

export const mcpCmd = (version: Version) =>
	Command.make('mcp').pipe(
		Command.withSubcommands([
			Command.make(
				'stdio',
				{
					bare: Flag.Boolean('bare'),
					aliases: Flag.String('alias').pipe(Flag.atLeast(0)),
					agents: Flag.String('agents').pipe(Flag.optional),
					engineUrl: Flag.String('engine-url').pipe(
						Flag.withDefault(defaultEngineUrl),
					),
					idleExit: Flag.String('idle-exit').pipe(Flag.withDefault('10m')),
				},
				(params) =>
					Effect.gen(function* () {
						const aliases = yield* parseAliases(params.aliases);
						const agents = yield* parseAgents(
							Option.getOrUndefined(params.agents),
						);
						yield* runMcpStdio({ ...params, version, aliases, agents });
					}),
			),
		]),
	);
