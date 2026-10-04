import { Context, Layer } from 'effect';
import { makeAcpAdapterHarness } from './acp-harness.ts';
import { Settings } from './settings.ts';

const adapter = makeAcpAdapterHarness({
	backend: 'pi',
	defaultBinary: 'pi-acp',
	binaryEnvVar: 'OAGENT_PI_BIN',
	effortConfigId: 'thought_level',
	// Pi has no literal default level; omitting the option preserves its choice.
	omitDefaultEffort: true,
	efforts: [
		{ value: 'default', label: 'Default' },
		{ value: 'off', label: 'Off' },
		{ value: 'minimal', label: 'Minimal' },
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'high', label: 'High' },
		{ value: 'xhigh', label: 'Extra high' },
		{ value: 'max', label: 'Max' },
	],
});

export const getPiBinary = adapter.getBinary;
export const resolvePiBinary = adapter.resolveBinary;
export const createPiAcpConfig = adapter.createConfig;
export const getPiConfigOptions = adapter.getConfigOptions;

export class Pi extends Context.Service<Pi>()('oagent/Pi', {
	make: adapter.make,
}) {
	static readonly layer = Layer.effect(Pi, Pi.make).pipe(
		Layer.provide(adapter.acpLayer),
		Layer.provide(Settings.layer),
	);
}
