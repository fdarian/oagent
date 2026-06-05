import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { Effect } from 'effect';
import {
	AcpSessionError,
	createAcpConnection,
	runAcpTurn,
} from './acp-agent.ts';

export class Grok extends Effect.Service<Grok>()('oagent/Grok', {
	effect: Effect.gen(function* () {
		const binary =
			process.env.OAGENT_GROK_BIN !== undefined
				? process.env.OAGENT_GROK_BIN
				: 'grok';

		const listModels = () =>
			Effect.tryPromise({
				try: async () => {
					const proc = Bun.spawn([binary, 'models'], { stdout: 'pipe' });
					const text = await new Response(proc.stdout).text();
					const exitCode = await proc.exited;
					if (exitCode !== 0) {
						throw new Error(`grok models exited with code ${exitCode}`);
					}
					const lines = text.split('\n');
					const availableIdx = lines.findIndex(
						(line) => line.trim() === 'Available models:',
					);
					if (availableIdx === -1) {
						throw new Error(
							'Unexpected grok models output: no "Available models:" section found',
						);
					}
					const models: { id: string }[] = [];
					for (let i = availableIdx + 1; i < lines.length; i++) {
						const rawLine = lines[i];
						if (rawLine === undefined) break;
						const line = rawLine.trim();
						if (line === '') break;
						let id = line;
						if (id.startsWith('- ') || id.startsWith('* ')) {
							id = id.slice(2);
						}
						const suffix = ' (default)';
						if (id.endsWith(suffix)) {
							id = id.slice(0, -suffix.length);
						}
						if (id.length > 0) {
							models.push({ id });
						}
					}
					if (models.length === 0) {
						throw new Error('No models found in grok models output');
					}
					return models;
				},
				catch: (cause) => new AcpSessionError({ cause }),
			});

		const runTurn = (input: {
			prompt: string;
			model?: string;
			sessionId?: string;
			cwd: string;
			onEvent?: (event: SessionUpdate) => void;
		}) =>
			Effect.scoped(
				Effect.gen(function* () {
					const args =
						input.model !== undefined
							? ['agent', '-m', input.model, 'stdio']
							: ['agent', 'stdio'];
					const connEnv = yield* createAcpConnection({
						binary,
						args,
						clientInfoName: 'oagent',
					});
					// WORKAROUND: grok cannot change the model once a session has been created
					// (unlike opencode/cursor which switch model per-turn over ACP), so the model
					// must be fixed at process launch via -m. This requires a fresh subprocess per turn.
					return yield* runAcpTurn(connEnv, { ...input, skipModelSet: true });
				}),
			);

		return { runTurn, listModels };
	}),
}) {}
