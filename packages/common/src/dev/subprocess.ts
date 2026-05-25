import * as CommandModule from '@effect/platform/Command';
import { Effect, pipe } from 'effect';

export const runManagedSubprocess = (
	cmd: string,
	args: string[],
	opts?: { env?: Record<string, string> },
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const command = pipe(
				CommandModule.make(cmd, ...args),
				CommandModule.stdin('inherit'),
				CommandModule.stdout('inherit'),
				CommandModule.stderr('inherit'),
				CommandModule.env({ ...process.env, ...(opts?.env ?? {}) }),
			);

			const child = yield* Effect.acquireRelease(
				CommandModule.start(command),
				(c) => c.kill().pipe(Effect.catchAll(() => Effect.void)),
			);

			return yield* child.exitCode;
		}),
	);
