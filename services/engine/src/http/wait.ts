import { Cause, Exit, Runtime } from 'effect';
import type { Jobs } from '../jobs.ts';

export async function handleJobWait(
	jobs: Jobs,
	jobId: string,
	timeoutMs: number,
	rt: Runtime.Runtime<never>,
): Promise<Response> {
	const exit = await Runtime.runPromiseExit(rt)(
		jobs.wait({ jobId, timeoutMs }),
	);

	if (Exit.isFailure(exit)) {
		const cause = exit.cause;
		if (Cause.isFailType(cause)) {
			const err = cause.error;
			if (
				err !== null &&
				typeof err === 'object' &&
				'_tag' in err &&
				err._tag === 'JobNotFound' &&
				'jobId' in err &&
				typeof err.jobId === 'string'
			) {
				return new Response(
					JSON.stringify({
						status: 'error',
						message: `Job not found: ${err.jobId}`,
					}),
					{ status: 404, headers: { 'content-type': 'application/json' } },
				);
			}
			const message = err instanceof Error ? err.message : String(err);
			return new Response(JSON.stringify({ status: 'error', message }), {
				status: 500,
				headers: { 'content-type': 'application/json' },
			});
		}
		return new Response(
			JSON.stringify({ status: 'error', message: Cause.pretty(cause) }),
			{ status: 500, headers: { 'content-type': 'application/json' } },
		);
	}

	return new Response(JSON.stringify(exit.value), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}
