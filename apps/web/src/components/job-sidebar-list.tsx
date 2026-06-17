import { Link } from '@tanstack/react-router';
import { formatAge, groupBySession } from '@/lib/format';
import { warmUpJobEvents } from '@/lib/job-warmup';
import type { JobListItem } from '@/lib/use-job-list';
import { cn } from '@/lib/utils';

export type JobSidebarListProps = {
	groups: { label: string; items: JobListItem[] };
	selectedId?: string;
};

function statusDotClass(status: string): string {
	if (status === 'running') return 'bg-verdant-accent';
	if (status === 'done') return 'bg-primary';
	return 'bg-destructive';
}

export function JobSidebarItem({
	job,
	selectedId,
}: {
	job: JobListItem;
	selectedId?: string;
}) {
	const isSelected = job.id === selectedId;
	const promptPreview = job.prompt.split('\n')[0]?.slice(0, 80) ?? job.id;
	return (
		<Link
			to="/jobs/$jobId"
			params={{ jobId: job.id }}
			onMouseEnter={() => warmUpJobEvents(job.id, selectedId)}
			className={cn(
				'flex flex-col gap-[6px] border-l px-22 py-15 text-left transition-colors',
				isSelected
					? 'border-l-ink bg-[color-mix(in_srgb,var(--color-ink)_3%,var(--color-canvas))] dark:bg-[color-mix(in_srgb,var(--color-ink)_8%,var(--color-canvas))]'
					: 'border-l-transparent hover:bg-[color-mix(in_srgb,var(--color-ink)_1%,var(--color-canvas))] dark:hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,var(--color-canvas))]',
			)}
		>
			<div className="flex items-center gap-15">
				<span
					className={cn(
						'inline-block h-[6px] w-[6px] shrink-0',
						statusDotClass(job.status),
					)}
				/>
				<span className="truncate text-caption font-light text-foreground">
					{promptPreview}
				</span>
			</div>
			<div className="flex items-center gap-15 text-caption text-muted-foreground">
				<span className="truncate">{job.cwd}</span>
				<span>·</span>
				<span>{formatAge(job.createdAt)}</span>
			</div>
		</Link>
	);
}

export function JobSidebarList({ groups, selectedId }: JobSidebarListProps) {
	return (
		<div className="flex flex-col">
			<div className="flex items-center justify-between px-22 py-15">
				<span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
					{groups.label}
				</span>
				<span className="text-caption font-medium text-muted-foreground">
					{groups.items.length}
				</span>
			</div>
			<div className="flex flex-col">
				{groups.items.map((job) => (
					<JobSidebarItem key={job.id} job={job} selectedId={selectedId} />
				))}
			</div>
		</div>
	);
}

export function JobSidebarSessionList({
	jobs,
	selectedId,
}: {
	jobs: JobListItem[];
	selectedId?: string;
}) {
	const sessionGroups = groupBySession(jobs);

	return (
		<div className="flex flex-col">
			{sessionGroups.map((group) => {
				const label =
					group.sessionId === null
						? 'No session'
						: group.sessionId.length > 8
							? `${group.sessionId.slice(0, 8)}…`
							: group.sessionId;
				return (
					<div
						key={group.sessionId ?? '__no_session__'}
						className="flex flex-col"
					>
						<div className="flex items-center justify-between px-22 py-15">
							<span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
								{label}
							</span>
							<span className="text-caption font-medium text-muted-foreground">
								{group.items.length}
							</span>
						</div>
						<div className="flex flex-col">
							{group.items.map((job) => (
								<JobSidebarItem
									key={job.id}
									job={job}
									selectedId={selectedId}
								/>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}
