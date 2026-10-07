import { Context, Layer } from 'effect';
import { makeAcpAdapterHarness } from './acp-harness.ts';
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
});

export const getClaudeBinary = adapter.getBinary;
export const resolveClaudeBinary = adapter.resolveBinary;
export const createClaudeAcpConfig = adapter.createConfig;
export const getClaudeConfigOptions = adapter.getConfigOptions;

export class Claude extends Context.Service<Claude>()('oagent/Claude', {
	make: adapter.make,
}) {
	static readonly layer = Layer.effect(Claude, Claude.make).pipe(
		Layer.provide(adapter.acpLayer),
		Layer.provide(Settings.layer),
	);
}
