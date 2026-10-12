import { formatTurnResult, progressMessage } from '@oagent/engine';
import { Effect, Option } from 'effect';
import { Flag } from 'effect/cli';
import { listenForTerminal } from '#/lib/channel-stream.ts';
import { type Engine, writeStdout } from '#/lib/engine-cli.ts';
import { pollWait, type WaitResult } from '#/lib/job-wait.ts';
import { errorMessage } from '#/lib/misc.ts';

const TITLE_MAX_LENGTH = 60;

export const jsonFlag = Flag.Boolean('json').pipe(
	Flag.withDefault(false),
	Flag.withDescription('Print JSON instead of markdown.'),
);

export const detachFlag = Flag.Boolean('detach').pipe(
	Flag.withDefault(false),
	Flag.withDescription(
		'Print the session and job IDs and exit without waiting for the turn to finish.',
	),
);

/** The first non-empty line of the prompt, trimmed and cut to the title limit. */
export function deriveTitle(prompt: string): string {
	const firstLine = prompt.split('\n').find((line) => line.trim() !== '');
	if (firstLine === undefined) {
		throw new Error('Cannot derive a title from an empty prompt');
	}
	return firstLine.trim().slice(0, TITLE_MAX_LENGTH).trimEnd();
}

/** Positional prompt wins; otherwise a piped stdin; otherwise it is an error. */
export async function resolvePrompt(input: {
	positional: string | undefined;
	stdinIsTTY: boolean;
	readStdin: () => Promise<string>;
}): Promise<string> {
	const prompt = await (async () => {
		if (input.positional !== undefined) return input.positional;
		if (input.stdinIsTTY) {
			throw new Error(
				'No prompt provided: pass it as an argument or pipe it on stdin.',
			);
		}
		return input.readStdin();
	})();
	if (prompt.trim() === '') {
		throw new Error('The prompt is empty.');
	}
	return prompt;
}

export function readPrompt(positional: Option.Option<string>) {
	return Effect.tryPromise({
		try: () =>
			resolvePrompt({
				positional: Option.getOrUndefined(positional),
				stdinIsTTY: process.stdin.isTTY === true,
				readStdin: () => Bun.stdin.text(),
			}),
		catch: (cause) =>
			cause instanceof Error ? cause : new Error(String(cause)),
	});
}

type StartedTurn = {
	sessionId: string;
	jobId: string;
	worktreePath?: string;
	worktreeBranch?: string;
	delivery?: 'started' | 'steered';
};

export function renderTurn(params: {
	json: boolean;
	started: StartedTurn;
	result: WaitResult;
}) {
	if (params.json) {
		return JSON.stringify({
			sessionId: params.started.sessionId,
			jobId: params.started.jobId,
			worktreePath: params.started.worktreePath,
			worktreeBranch: params.started.worktreeBranch,
			...params.result,
		});
	}
	return formatTurnResult({
		sessionId: params.started.sessionId,
		jobId: params.started.jobId,
		result: params.result,
		worktreePath: params.started.worktreePath,
		worktreeBranch: params.started.worktreeBranch,
	});
}

function renderDetached(params: { json: boolean; started: StartedTurn }) {
	const started = params.started;
	if (params.json) {
		return JSON.stringify({ ...started, status: 'running' });
	}
	if (started.delivery === 'steered') {
		return formatTurnResult({
			sessionId: started.sessionId,
			jobId: started.jobId,
			result: { status: 'running' },
			steered: true,
		});
	}
	const lines = [
		`Session ID: ${started.sessionId}`,
		`Job ID: ${started.jobId}`,
		'Status: running',
	];
	if (started.worktreePath !== undefined) {
		const branch =
			started.worktreeBranch === undefined
				? ''
				: ` (${started.worktreeBranch})`;
		lines.push(`Worktree: ${started.worktreePath}${branch}`);
	}
	lines.push(
		`Run \`oagent session read ${started.sessionId} --wait\` to wait for the result.`,
	);
	return lines.join('\n');
}

/**
 * Streams progress to stderr, then waits for the terminal result. Progress is
 * best-effort: if the event stream gives up, the result is still polled.
 */
function waitForeground(engine: Engine, jobId: string) {
	return Effect.gen(function* () {
		yield* listenForTerminal(engine.url, jobId, async (event) => {
			const message = progressMessage(event);
			if (message !== undefined) process.stderr.write(`${message}\n`);
		}).pipe(
			Effect.catch((cause) =>
				Effect.sync(() =>
					process.stderr.write(
						`Live progress unavailable (${errorMessage(cause)}); waiting for the result.\n`,
					),
				),
			),
		);
		return yield* Effect.tryPromise({
			try: () => pollWait(engine.client, jobId),
			catch: (cause) =>
				cause instanceof Error ? cause : new Error(String(cause)),
		});
	});
}

/** Shared tail of `start` and `send`: detach, or stream progress and print the result. */
export function finishStartedTurn(params: {
	engine: Engine;
	started: StartedTurn;
	detach: boolean;
	json: boolean;
}) {
	return Effect.gen(function* () {
		// A steered message joins a turn that is already running, so there is no new result to wait for.
		if (params.detach || params.started.delivery === 'steered') {
			writeStdout(
				renderDetached({ json: params.json, started: params.started }),
			);
			return;
		}
		process.stderr.write(
			`Session ${params.started.sessionId}, job ${params.started.jobId}\n`,
		);
		const result = yield* waitForeground(params.engine, params.started.jobId);
		writeStdout(
			renderTurn({ json: params.json, started: params.started, result }),
		);
	});
}
