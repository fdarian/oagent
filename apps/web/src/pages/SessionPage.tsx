import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { orpc } from '@/lib/orpc';
import { SessionDetail } from './JobDetailPage';

export function SessionPage() {
	const params = useParams({ from: '/console/sessions/$sessionId' });
	return <SessionContent key={params.sessionId} sessionId={params.sessionId} />;
}

function SessionContent(props: { sessionId: string }) {
	const query = useQuery(
		orpc.sessions.get.queryOptions({ input: { sessionId: props.sessionId } }),
	);
	if (query.isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				Loading session…
			</div>
		);
	}
	if (query.isError) {
		return (
			<div className="flex h-full items-center justify-center text-destructive">
				{query.error.message}
			</div>
		);
	}
	const session = query.data;
	if (session === undefined) return null;
	const latest = session.jobs[session.jobs.length - 1];
	if (latest === undefined) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				No jobs in this session
			</div>
		);
	}
	return (
		<SessionDetail key={latest.id} jobId={latest.id} jobs={session.jobs} />
	);
}
