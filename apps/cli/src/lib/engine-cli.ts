import { formatSessionError, formatToolError } from '@oagent/engine';
import { encode } from '@toon-format/toon';
import { Effect } from 'effect';
import { Flag } from 'effect/cli';
import {
	createEngineClient,
	defaultEngineUrl,
	type EngineClient,
} from '#/lib/engine-client.ts';
import { ensureEngine, retryEngineRpc } from '#/lib/engine-spawn.ts';
import { errorMessage } from '#/lib/misc.ts';

export const engineUrlFlag = Flag.String('engine-url').pipe(
	Flag.withDefault(defaultEngineUrl),
	Flag.withDescription(
		'Base URL of the oagent engine (default: http://localhost:17777 or $OPENCODE_MCP_PORT). A local engine is started on demand if none is running.',
	),
);

export const formatFlag = Flag.Literals('format', ['toon', 'json']).pipe(
	Flag.withDefault('toon'),
	Flag.withDescription(
		'Output format. toon (default) is the compact, token-efficient format for agent/LLM consumption; json is full-fidelity for piping.',
	),
);

export type Engine = { url: string; client: EngineClient };

export function connectEngine(url: string): Engine {
	return { url, client: createEngineClient(url) };
}

/** Runs an RPC, starting a local engine and retrying once if the connection is refused. */
export function callEngine<A>(
	engine: Engine,
	fn: (client: EngineClient) => Promise<A>,
) {
	return retryEngineRpc(() => fn(engine.client), ensureEngine(engine.url));
}

export function writeStdout(text: string) {
	process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

export function renderStructured(data: unknown, format: 'toon' | 'json') {
	return format === 'json' ? JSON.stringify(data) : encode(data);
}

/** Prints the failure to stderr and sets exit code 1 instead of failing the program. */
export function reportFailure(params: {
	json: boolean;
	sessionId?: string;
}): <A, E, R>(
	effect: Effect.Effect<A, E, R>,
) => Effect.Effect<A | undefined, never, R> {
	return (effect) =>
		effect.pipe(
			Effect.catch((cause) =>
				Effect.sync(() => {
					const message = errorMessage(cause);
					const output = params.json
						? JSON.stringify({
								status: 'error',
								...(params.sessionId === undefined
									? {}
									: { sessionId: params.sessionId }),
								message,
							})
						: params.sessionId === undefined
							? formatToolError(message)
							: formatSessionError(params.sessionId, message);
					process.stderr.write(`${output}\n`);
					process.exitCode = 1;
					return undefined;
				}),
			),
		);
}
