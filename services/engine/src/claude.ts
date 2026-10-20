import { Context, Duration, Effect, Layer } from 'effect';
import { makeAcpAdapterHarness } from './acp-harness.ts';
import { claudeRawMessageFilter } from './claude-background-tasks.ts';
import { loadConfig } from './config.ts';
import { Settings } from './settings.ts';

const adapter = makeAcpAdapterHarness({
	backend: 'claude',
	defaultBinary: 'claude-agent-acp',
	binaryEnvVar: 'OAGENT_CLAUDE_BIN',
	effortConfigId: 'effort',
	efforts: [
		{ value: 'default', label: 'Default' },
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'high', label: 'High' },
		{ value: 'max', label: 'Max' },
	],
	nativeSubagents: true,
	sessionMeta: {
		claudeCode: {
			// Background task state is only visible in raw SDK messages.
			emitRawSDKMessages: claudeRawMessageFilter,
			// Without this the adapter keeps subagent text internal to the Agent tool call.
			options: { forwardSubagentText: true },
		},
	},
});

export const getClaudeBinary = adapter.getBinary;
export const resolveClaudeBinary = adapter.resolveBinary;
export const createClaudeAcpConfig = adapter.createConfig;
export const getClaudeConfigOptions = adapter.getConfigOptions;

export class Claude extends Context.Service<Claude>()('oagent/Claude', {
	make: Effect.gen(function* () {
		const config = yield* loadConfig();
		return yield* adapter.makeWith({
			backgroundHoldMaxMs: Duration.toMillis(
				Duration.minutes(config.claudeBackgroundHoldMinutes),
			),
		});
	}),
}) {
	static readonly layer = Layer.effect(Claude, Claude.make).pipe(
		Layer.provide(adapter.acpLayer),
		Layer.provide(Settings.layer),
	);
}
