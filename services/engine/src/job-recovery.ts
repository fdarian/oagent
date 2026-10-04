import { Effect } from 'effect';

export const continuationPrompt =
	"The oagent engine restarted and interrupted your previous turn. Before continuing, inspect the current files and the state of any commands you were running: results from the interrupted turn may be missing even if their side effects happened, so don't blindly repeat non-idempotent actions. Then continue the original task.";

export const isRunnerAlive = (pid: number): Effect.Effect<boolean, unknown> =>
	Effect.try({
		try: () => {
			process.kill(pid, 0);
			return true;
		},
		catch: (cause) => cause,
	}).pipe(
		Effect.catch((cause) =>
			typeof cause === 'object' && cause !== null && 'code' in cause
				? cause.code === 'ESRCH'
					? Effect.succeed(false)
					: cause.code === 'EPERM'
						? Effect.succeed(true)
						: Effect.fail(cause)
				: Effect.fail(cause),
		),
	);

export function recoveryDecision(input: {
	runnerAlive: boolean;
	resumeCount: number;
	backend: string;
	interruptedAt: Date | null;
	harnessSessionId: string | null;
	model: string | null;
}): 'skip' | 'resume' | { error: string } {
	if (input.runnerAlive) return 'skip';
	if (input.resumeCount >= 3) {
		return { error: 'engine restarted too many times while running' };
	}
	if (input.backend === 'cursor' && input.interruptedAt === null) {
		return { error: 'engine restarted while running' };
	}
	if (input.harnessSessionId === null) {
		return { error: 'engine restarted without a persisted harness session' };
	}
	if (input.model === null) {
		return { error: 'engine restarted without a persisted model' };
	}
	return 'resume';
}
