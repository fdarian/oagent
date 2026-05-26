import { CopyIcon, MaximizeIcon, XCircleIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { formatAge, formatElapsed } from '@/lib/format';
import { cn } from '@/lib/utils';

export type JobHeaderProps = {
	id: string;
	status: string;
	prompt: string;
	cwd: string;
	model?: string;
	createdAt: number;
	terminatedAt?: number;
	onCancel?: () => void;
	onExpandPrompt?: () => void;
};

export function JobHeader({
	id,
	status,
	prompt,
	cwd,
	model,
	createdAt,
	terminatedAt,
	onCancel,
	onExpandPrompt,
}: JobHeaderProps) {
	const [copied, setCopied] = useState(false);

	const handleCopyId = useCallback(() => {
		navigator.clipboard.writeText(id).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}, [id]);

	const promptLines = prompt.split('\n').slice(0, 2).join('\n');
	const elapsed = formatElapsed(createdAt, terminatedAt);

	const statusDot =
		status === 'running' ? (
			<span className="inline-block h-[6px] w-[6px] bg-verdant-accent" />
		) : status === 'done' ? (
			<span className="inline-block h-[6px] w-[6px] bg-primary" />
		) : (
			<span className="inline-block h-[6px] w-[6px] bg-destructive" />
		);

	const isPromptTruncated =
		prompt.split('\n').length > 2 || prompt !== promptLines;

	return (
		<div className="flex flex-col gap-15 border-b border-border pb-22">
			<div className="flex items-start justify-between gap-15">
				<div className="flex min-w-0 flex-1 flex-col gap-15">
					<div className="group relative">
						<pre className="whitespace-pre-wrap text-body font-light text-foreground">
							{promptLines}
						</pre>
						{isPromptTruncated && onExpandPrompt !== undefined && (
							<button
								type="button"
								onClick={onExpandPrompt}
								className="mt-1 flex items-center gap-1 text-caption text-muted-foreground transition-colors hover:text-foreground"
							>
								<MaximizeIcon className="h-3 w-3" />
								View full prompt
							</button>
						)}
					</div>
					<div className="flex items-center gap-15 text-caption text-muted-foreground">
						<span className="truncate">{cwd}</span>
						<span>·</span>
						<span>started {formatAge(createdAt)}</span>
						<span>·</span>
						<span>{elapsed}</span>
						{model !== undefined && model !== '' && (
							<>
								<span>·</span>
								<span>{model}</span>
							</>
						)}
					</div>
				</div>
				<div className="flex items-center gap-15">
					<div
						className={cn(
							'flex items-center gap-[6px] border px-2 py-1 text-caption',
							status === 'running'
								? 'border-verdant-accent text-verdant-accent'
								: status === 'done'
									? 'border-primary text-primary'
									: 'border-destructive text-destructive',
						)}
					>
						{statusDot}
						<span className="uppercase">{status}</span>
					</div>
					{status === 'running' && onCancel !== undefined && (
						<button
							type="button"
							onClick={onCancel}
							className="flex items-center gap-1 border border-destructive px-2 py-1 text-caption text-destructive transition-colors hover:bg-destructive hover:text-canvas"
						>
							<XCircleIcon className="h-3 w-3" />
							Cancel
						</button>
					)}
					<button
						type="button"
						onClick={handleCopyId}
						className="flex items-center gap-1 border border-border px-2 py-1 text-caption text-muted-foreground transition-colors hover:border-ink hover:text-foreground"
					>
						<CopyIcon className="h-3 w-3" />
						{copied ? 'Copied' : 'ID'}
					</button>
				</div>
			</div>
		</div>
	);
}
