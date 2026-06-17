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
		<div className="flex h-screen w-screen overflow-hidden bg-background">
			<JobSidebar
				grouped={jobList.grouped}
				jobs={jobList.jobs}
				selectedId={selectedId}
				isLoading={jobList.isLoading}
				cwdFilter={jobList.cwdFilter}
				onCwdFilterChange={jobList.setCwdFilter}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<Outlet />
			</div>
		</div>
	);
}
