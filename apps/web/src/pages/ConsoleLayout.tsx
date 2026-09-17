import { Outlet, useMatch } from '@tanstack/react-router';
import { JobSidebar } from '@/components/job-sidebar';
import { useJobList } from '@/lib/use-job-list';

export function ConsoleLayout() {
	const jobList = useJobList();
	const jobMatch = useMatch({
		from: '/console/jobs/$jobId',
		shouldThrow: false,
	});
	const selectedId = jobMatch === undefined ? undefined : jobMatch.params.jobId;

	return (
		<div className="flex h-screen w-screen flex-col overflow-hidden bg-background sm:flex-row">
			<JobSidebar
				grouped={jobList.grouped}
				jobs={jobList.jobs}
				selectedId={selectedId}
				isLoading={jobList.isLoading}
				cwdFilter={jobList.cwdFilter}
				onCwdFilterChange={jobList.setCwdFilter}
			/>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<Outlet />
			</div>
		</div>
	);
}
