import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { JobHeader } from '@/components/job-header';
import { JobPromptView } from '@/components/job-prompt-view';
import { JobStatusStrip } from '@/components/job-status-strip';
import { JobTimeline } from '@/components/job-timeline';
import { SubagentDock } from '@/components/subagent-dock';
import { SubagentHeader } from '@/components/subagent-header';
import { orpc } from '@/lib/orpc';
import { queryKeys } from '@/lib/query-keys';
import { useJobEvents } from '@/lib/use-job-events';
import { useJobList } from '@/lib/use-job-list';

export function JobDetailPage() {
	const params = useParams({ from: '/console/jobs/$jobId' });
	const jobId = params.jobId;
	const [isPromptExpanded, setIsPromptExpanded] = useState(false);
	const activeChildState = useState<
		{ jobId: string; sessionId: string } | undefined
	>(undefined);
	const childSelection = activeChildState[0];
	const setChildSelection = activeChildState[1];
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
	const activeChildSessionId =
		childSelection === undefined || childSelection.jobId !== jobId
			? undefined
			: childSelection.sessionId;
	const activeChild =
		activeChildSessionId === undefined
			? undefined
			: events.children.get(activeChildSessionId);

	const selectChild = (sessionId: string) => {
		setChildSelection({ jobId, sessionId });
	};

	const navigateChild = (sessionId: string | undefined) => {
		setChildSelection(
			sessionId === undefined ? undefined : { jobId, sessionId },
		);
	};

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
					status={
						activeChild === undefined
							? events.lastStatus
							: activeChild.lastStatus
					}
					isRunning={
						selectedJob.status === 'running' &&
						!events.terminal &&
						(activeChild === undefined || activeChild.status === 'running')
					}
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
						key={
							activeChildSessionId === undefined
								? 'parent'
								: activeChildSessionId
						}
						parts={activeChild === undefined ? events.parts : activeChild.parts}
						streamingTail={
							activeChild === undefined
								? events.streamingTail
								: activeChild.streamingTail
						}
						cwd={selectedJob.cwd}
						childSessions={events.children}
						currentChild={activeChild}
						onChildSelect={selectChild}
						isChildTimeline={activeChild !== undefined}
						isLoading={
							events.isLoading &&
							(activeChild === undefined
								? events.parts.length === 0 && events.streamingTail === null
								: activeChild.parts.length === 0 &&
									activeChild.streamingTail === null)
						}
						header={
							activeChild === undefined ? (
								<div className="px-33 py-22">
									<div className="mx-auto max-w-[900px]">
										<JobHeader
											id={selectedJob.id}
											status={status}
											prompt={selectedJob.prompt}
											cwd={selectedJob.cwd}
											backend={selectedJob.backend}
											model={selectedJob.model}
											sessionId={selectedJob.sessionId}
											createdAt={selectedJob.createdAt}
											terminatedAt={selectedJob.terminatedAt}
											onCancel={() => {
												cancelJob.mutate(selectedJob.id);
											}}
											onExpandPrompt={() => setIsPromptExpanded(true)}
										/>
									</div>
								</div>
							) : (
								<SubagentHeader
									child={activeChild}
									sessions={events.children}
									onNavigate={navigateChild}
								/>
							)
						}
					/>
					<SubagentDock
						sessions={events.children}
						activeChildSessionId={activeChildSessionId}
						onSelect={selectChild}
					/>
				</div>
			)}
		</>
	);
}
