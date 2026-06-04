import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { JobHeader } from '@/components/job-header';
import { JobPromptView } from '@/components/job-prompt-view';
import { JobStatusStrip } from '@/components/job-status-strip';
import { JobTimeline } from '@/components/job-timeline';
import { orpc } from '@/lib/orpc';
import { queryKeys } from '@/lib/query-keys';
import { useJobEvents } from '@/lib/use-job-events';
import { useJobList } from '@/lib/use-job-list';

export function JobDetailPage() {
	const params = useParams({ from: '/jobs/$jobId' });
	const jobId = params.jobId;
	const [isPromptExpanded, setIsPromptExpanded] = useState(false);
	const jobList = useJobList();
	const events = useJobEvents(jobId);
	const queryClient = useQueryClient();

	const cancelJob = useMutation({
		mutationFn: (id: string) => orpc.jobs.cancel({ jobId: id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
		},
		onError: (error) => {
			console.error('Failed to cancel job', error);
		},
	});

	const selectedJob = jobList.grouped
		.flatMap((g) => g.items)
		.find((j) => j.id === jobId);

	if (selectedJob === undefined) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-22 text-muted-foreground">
				<p className="text-body font-light">Job not found</p>
			</div>
		);
	}

	const status =
		selectedJob.status !== 'running'
			? selectedJob.status
			: events.terminal
				? events.parts.some((p) => p.kind === 'error')
					? 'error'
					: 'done'
				: selectedJob.status;

	return (
		<>
			<div className="flex flex-col gap-0">
				<JobStatusStrip
					status={events.lastStatus}
					isRunning={selectedJob.status === 'running' && !events.terminal}
				/>
			</div>
			{isPromptExpanded ? (
				<JobPromptView
					prompt={selectedJob.prompt}
					onClose={() => setIsPromptExpanded(false)}
				/>
			) : (
				<div className="flex min-h-0 flex-1 flex-col">
					<JobTimeline
						parts={events.parts}
						streamingTail={events.streamingTail}
						isLoading={
							events.isLoading &&
							events.parts.length === 0 &&
							events.streamingTail === null
						}
						header={
							<div className="px-33 py-22">
								<div className="mx-auto max-w-[900px]">
									<JobHeader
										id={selectedJob.id}
										status={status}
										prompt={selectedJob.prompt}
										cwd={selectedJob.cwd}
										model={selectedJob.model}
										createdAt={selectedJob.createdAt}
										terminatedAt={selectedJob.terminatedAt}
										onCancel={() => {
											cancelJob.mutate(selectedJob.id);
										}}
										onExpandPrompt={() => setIsPromptExpanded(true)}
									/>
								</div>
							</div>
						}
					/>
				</div>
			)}
		</>
	);
}
