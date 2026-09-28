import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams, useSearch } from '@tanstack/react-router';
import { orpc } from '@/lib/orpc';

export function JobRedirectPage() {
	const params = useParams({ from: '/console/jobs/$jobId' });
	const search = useSearch({ from: '/console/jobs/$jobId' });
	const job = useQuery(
		orpc.jobs.get.queryOptions({ input: { jobId: params.jobId } }),
	);

	if (job.isPending) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				Finding session…
			</div>
		);
	}
	if (job.isError) {
		return (
			<div className="flex h-full items-center justify-center text-destructive">
				Could not find the job's session: {job.error.message}
			</div>
		);
	}
	if (job.data === undefined) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				Job not found
			</div>
		);
	}

	return (
		<Navigate
			to="/sessions/$sessionId"
			params={{ sessionId: job.data.sessionId }}
			search={search}
			replace
		/>
	);
}
