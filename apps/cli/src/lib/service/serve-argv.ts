import path from 'node:path';

export type ServeArgv = {
	/** Tokens before `serve`: the executable, plus the entrypoint when run through bun. */
	binary: ReadonlyArray<string>;
	port: number | undefined;
	portless: boolean;
	idleExit: boolean;
};

export type RequestedDaemon = {
	binary: ReadonlyArray<string>;
	port: number;
	portless: boolean;
};

export function tokenizeCommand(command: string): ReadonlyArray<string> {
	return command.split(/\s+/).filter((token) => token.length > 0);
}

export function findServeIndex(
	tokens: ReadonlyArray<string>,
): number | undefined {
	for (let index = 0; index < tokens.length - 1; index += 1) {
		const token = tokens[index];
		if (token === undefined) {
			continue;
		}

		const commandName = path.basename(token);
		if (
			(commandName === 'oagent' ||
				commandName.endsWith('oagent') ||
				commandName === 'index.ts') &&
			tokens[index + 1] === 'serve'
		) {
			return index + 1;
		}
	}

	return undefined;
}

function readPort(args: ReadonlyArray<string>): number | undefined {
	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];
		let value: string | undefined;
		if (token === '--port' || token === '-p') {
			value = args[index + 1];
		} else if (token?.startsWith('--port=')) {
			value = token.slice('--port='.length);
		}
		if (value !== undefined && /^\d+$/.test(value)) {
			return Number.parseInt(value, 10);
		}
	}

	return undefined;
}

export function parseServeArgv(
	tokens: ReadonlyArray<string>,
): ServeArgv | undefined {
	const serveIndex = findServeIndex(tokens);
	if (serveIndex === undefined) {
		return undefined;
	}

	const args = tokens.slice(serveIndex + 1);
	return {
		binary: tokens.slice(0, serveIndex),
		port: readPort(args),
		portless: args.includes('--portless'),
		idleExit: args.some(
			(token) => token === '--idle-exit' || token.startsWith('--idle-exit='),
		),
	};
}

/** One line per setting where the running daemon differs from the request. */
export function describeDaemonMismatch(
	running: ServeArgv,
	requested: RequestedDaemon,
): ReadonlyArray<string> {
	const differences: Array<string> = [];
	if (running.port !== requested.port) {
		differences.push(
			`port: running ${running.port ?? 'unknown'}, requested ${requested.port}`,
		);
	}
	if (running.portless !== requested.portless) {
		differences.push(
			`portless: running ${running.portless ? 'yes' : 'no'}, requested ${requested.portless ? 'yes' : 'no'}`,
		);
	}
	const sameBinary =
		running.binary.length === requested.binary.length &&
		running.binary.every((token, index) => token === requested.binary[index]);
	if (!sameBinary) {
		differences.push(
			`binary: running ${running.binary.join(' ')}, requested ${requested.binary.join(' ')}`,
		);
	}
	return differences;
}

/**
 * Single line on purpose: the default error renderer prints the message and
 * then the stack, which embeds the message again, so every extra line is
 * shown twice.
 */
export function formatDaemonMismatchMessage(
	pid: number,
	differences: ReadonlyArray<string>,
): string {
	return `oagent serve is already running (pid ${pid}) with different settings (${differences.join('; ')}); run \`oagent service stop\` first, then start again`;
}
