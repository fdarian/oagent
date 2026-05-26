import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { JobEmptyState } from '@/components/job-empty-state';
import { JobHeader } from '@/components/job-header';
import { JobPromptView } from '@/components/job-prompt-view';
import { JobSidebar } from '@/components/job-sidebar';
import { JobStatusStrip } from '@/components/job-status-strip';
import { JobTimeline } from '@/components/job-timeline';
import { useJobEvents } from '@/lib/use-job-events';
import { useJobList } from '@/lib/use-job-list';

export function ConsolePage() {
	const [selectedId, setSelectedId] = useState<string | undefined>();
	const [isPromptExpanded, setIsPromptExpanded] = useState(false);
	const { grouped, isLoading, cwdFilter, setCwdFilter } = useJobList();
	const events = useJobEvents(selectedId);
	const queryClient = useQueryClient();

	// Find selected job metadata from the list
	const selectedJob = grouped
		.flatMap((g) => g.items)
		.find((j) => j.id === selectedId);

	return (
		<div className="flex h-screen w-screen overflow-hidden bg-background">
			<JobSidebar
				grouped={grouped}
				selectedId={selectedId}
				isLoading={isLoading}
				cwdFilter={cwdFilter}
				onCwdFilterChange={setCwdFilter}
				onSelectJob={(id) => {
					setSelectedId(id);
				}}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				{selectedJob === undefined ? (
					<JobEmptyState />
				) : (
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
							<div className="min-h-0 flex-1 overflow-y-auto px-33 py-22">
								<div className="mx-auto max-w-[900px]">
									<JobHeader
										id={selectedJob.id}
										status={
											events.terminal
												? events.parts.some((p) => p.kind === 'error')
													? 'error'
													: 'done'
												: selectedJob.status
										}
										prompt={selectedJob.prompt}
										cwd={selectedJob.cwd}
										model={selectedJob.model}
										createdAt={selectedJob.createdAt}
										terminatedAt={selectedJob.terminatedAt}
										onCancel={() => {
											// TODO: wire cancel when engine supports it
											queryClient.invalidateQueries({ queryKey: ['jobs'] });
										}}
										onExpandPrompt={() => setIsPromptExpanded(true)}
									/>
									<div className="mt-22">
										<JobTimeline parts={events.parts} />
									</div>
								</div>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
