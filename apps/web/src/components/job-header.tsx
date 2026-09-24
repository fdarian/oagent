import {
	CheckIcon,
	CopyIcon,
	EllipsisIcon,
	MaximizeIcon,
	XCircleIcon,
} from 'lucide-react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover';
import { formatAge, formatElapsed } from '@/lib/format';
import { type Backend, HARNESS_NAMES } from '@/lib/harnesses';
import { cn } from '@/lib/utils';
import { ActionRow } from './ui/action-row';

export type JobHeaderProps = {
	id: string;
	status: string;
	prompt: string;
	cwd: string;
	worktreePath?: string;
	worktreeBranch?: string;
	backend: Backend;
	model?: string;
	agentType?: string;
	sessionId?: string;
	harnessSessionId?: string;
	createdAt: number;
	terminatedAt?: number;
	onCancel?: () => void;
	onExpandPrompt?: () => void;
	onNewSideChat?: () => void;
	onOpenSideChats?: () => void;
	isCreatingSideChat?: boolean;
	moreTriggerRef?: RefObject<HTMLButtonElement | null>;
};

const moreMenuItemClassName =
	'bg-popover text-popover-foreground hover:bg-secondary hover:text-secondary-foreground focus:bg-secondary focus:text-secondary-foreground data-[highlighted]:bg-secondary data-[highlighted]:text-secondary-foreground';

type HarnessSessionPopoverProps = {
	backend: Backend;
	sessionId?: string;
	harnessSessionId?: string;
};

type SessionIdRowProps = {
	label: string;
	id?: string;
};

function SessionIdRow(props: SessionIdRowProps) {
	const [copied, setCopied] = useState(false);
	const copyTimeout = useRef<number | undefined>(undefined);

	useEffect(
		() => () => {
			if (copyTimeout.current !== undefined) {
				window.clearTimeout(copyTimeout.current);
			}
		},
		[],
	);

	const handleCopy = () => {
		if (props.id === undefined) return;
		if (typeof navigator.clipboard === 'undefined') {
			console.error('Clipboard API unavailable');
			return;
		}

		void navigator.clipboard.writeText(props.id).then(
			() => {
				setCopied(true);
				if (copyTimeout.current !== undefined) {
					window.clearTimeout(copyTimeout.current);
				}
				copyTimeout.current = window.setTimeout(() => {
					copyTimeout.current = undefined;
					setCopied(false);
				}, 1500);
			},
			(error: unknown) => {
				console.error(`Failed to copy ${props.label.toLowerCase()}`, error);
			},
		);
	};

	return (
		<div className="flex flex-col gap-1">
			<span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
				{props.label}
			</span>
			{props.id === undefined ? (
				<span className="text-caption text-muted-foreground">
					Not available yet
				</span>
			) : (
				<div className="flex min-w-0 items-center gap-10 border border-border px-10 py-1">
					<code
						className="min-w-0 flex-1 truncate font-mono text-caption text-foreground"
						title={props.id}
					>
						{props.id}
					</code>
					<button
						type="button"
						aria-label={`Copy ${props.label.toLowerCase()}`}
						title={`Copy ${props.label.toLowerCase()}`}
						onClick={handleCopy}
						className="flex size-6 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
					>
						{copied ? (
							<CheckIcon className="size-3 text-verdant-accent" />
						) : (
							<CopyIcon className="size-3" />
						)}
					</button>
				</div>
			)}
		</div>
	);
}

function HarnessSessionPopover(props: HarnessSessionPopoverProps) {
	const [open, setOpen] = useState(false);
	const closeTimeout = useRef<number | undefined>(undefined);

	useEffect(
		() => () => {
			if (closeTimeout.current !== undefined) {
				window.clearTimeout(closeTimeout.current);
			}
		},
		[],
	);

	const clearCloseTimeout = () => {
		if (closeTimeout.current === undefined) return;
		window.clearTimeout(closeTimeout.current);
		closeTimeout.current = undefined;
	};

	const handleOpen = () => {
		clearCloseTimeout();
		setOpen(true);
	};

	const handleClose = () => {
		clearCloseTimeout();
		closeTimeout.current = window.setTimeout(() => {
			closeTimeout.current = undefined;
			setOpen(false);
		}, 120);
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (nextOpen) clearCloseTimeout();
		setOpen(nextOpen);
	};

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger
				render={
					<Badge
						variant="outline"
						className="cursor-help rounded-none border-border bg-transparent px-1.5 py-0 font-light text-caption text-muted-foreground hover:bg-secondary hover:text-foreground"
						render={
							<button
								type="button"
								aria-label={`${HARNESS_NAMES[props.backend]} harness; show session IDs`}
								onPointerEnter={handleOpen}
								onPointerLeave={handleClose}
								onFocus={handleOpen}
								onBlur={handleClose}
							>
								{HARNESS_NAMES[props.backend]}
							</button>
						}
					></Badge>
				}
			/>
			<PopoverContent
				align="start"
				sideOffset={8}
				aria-label="Session details"
				className="w-[min(24rem,calc(100vw-2rem))] rounded-none p-15"
				onPointerEnter={handleOpen}
				onPointerLeave={handleClose}
				onFocus={handleOpen}
				onBlur={handleClose}
			>
				<div className="flex flex-col gap-10">
					<div className="flex items-center justify-between gap-15">
						<span className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
							Session IDs
						</span>
						<span className="text-caption text-muted-foreground">
							{HARNESS_NAMES[props.backend]}
						</span>
					</div>
					<SessionIdRow label="Oagent session ID" id={props.sessionId} />
					<SessionIdRow
						label="Harness session ID"
						id={props.harnessSessionId}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export function JobHeader(props: JobHeaderProps) {
	const [copied, setCopied] = useState(false);

	const handleCopyId = () => {
		navigator.clipboard.writeText(props.id).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};

	const promptLines = props.prompt.split('\n').slice(0, 2).join('\n');
	const elapsed = formatElapsed(props.createdAt, props.terminatedAt);

	const statusDot =
		props.status === 'running' ? (
			<span className="inline-block h-[6px] w-[6px] bg-verdant-accent" />
		) : props.status === 'done' ? (
			<span className="inline-block h-[6px] w-[6px] bg-primary" />
		) : (
			<span className="inline-block h-[6px] w-[6px] bg-destructive" />
		);

	const isPromptTruncated =
		props.prompt.split('\n').length > 2 || props.prompt !== promptLines;

	return (
		<div className="flex flex-col gap-15 border-b border-border pb-22">
			<div className="flex flex-wrap items-start justify-between gap-15">
				<div className="flex min-w-0 flex-1 flex-col gap-15">
					<div className="group relative">
						<pre className="whitespace-pre-wrap text-body font-light text-foreground">
							{promptLines}
						</pre>
						{isPromptTruncated && props.onExpandPrompt !== undefined && (
							<button
								type="button"
								onClick={props.onExpandPrompt}
								className="mt-1 flex items-center gap-1 text-caption text-muted-foreground transition-colors hover:text-foreground"
							>
								<MaximizeIcon className="h-3 w-3" />
								View full prompt
							</button>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-x-15 gap-y-1 text-caption text-muted-foreground">
						<span className="min-w-0 max-w-full truncate">{props.cwd}</span>
						<span>·</span>
						<span>started {formatAge(props.createdAt)}</span>
						<span>·</span>
						<span>{elapsed}</span>
						<span>·</span>
						<span className="flex min-w-0 max-w-full items-center gap-10">
							{props.model !== undefined && props.model !== '' && (
								<span className="truncate">{props.model}</span>
							)}
							{props.agentType !== undefined && props.agentType !== '' && (
								<Badge
									variant="outline"
									className="max-w-full truncate rounded-none border-border bg-transparent px-1.5 py-0 font-light text-caption text-muted-foreground"
									title={props.agentType}
								>
									{props.agentType}
								</Badge>
							)}
							<HarnessSessionPopover
								backend={props.backend}
								sessionId={props.sessionId}
								harnessSessionId={props.harnessSessionId}
							/>
						</span>
					</div>
					{props.worktreePath !== undefined && (
						<div className="flex flex-wrap gap-x-3 text-caption text-muted-foreground">
							<span>Worktree: {props.worktreeBranch}</span>
							<code className="break-all" title={props.worktreePath}>
								{props.worktreePath}
							</code>
						</div>
					)}
				</div>
				<ActionRow size="md">
					<div
						className={cn(
							'flex items-center gap-[6px] border px-2 py-1 text-caption',
							props.status === 'running'
								? 'border-verdant-accent text-verdant-accent'
								: props.status === 'done'
									? 'border-primary text-primary'
									: 'border-destructive text-destructive',
						)}
					>
						{statusDot}
						<span className="uppercase">{props.status}</span>
					</div>
					{props.status === 'running' && props.onCancel !== undefined && (
						<button
							type="button"
							onClick={props.onCancel}
							className="flex items-center gap-1 border border-destructive px-2 py-1 text-caption text-destructive transition-colors hover:bg-destructive hover:text-canvas"
						>
							<XCircleIcon className="h-3 w-3" />
							Cancel
						</button>
					)}
					{(props.onNewSideChat !== undefined ||
						props.onOpenSideChats !== undefined) && (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<button
										ref={props.moreTriggerRef}
										type="button"
										className="flex items-center gap-1 border border-border px-2 py-1 text-caption text-muted-foreground transition-colors hover:border-ink hover:text-foreground"
									>
										<EllipsisIcon className="h-3 w-3" />
										More
									</button>
								}
							/>
							<DropdownMenuContent align="end">
								{props.onOpenSideChats !== undefined && (
									<DropdownMenuItem
										className={moreMenuItemClassName}
										onSelect={props.onOpenSideChats}
									>
										Open side chats
									</DropdownMenuItem>
								)}
								{props.onNewSideChat !== undefined && (
									<DropdownMenuItem
										className={moreMenuItemClassName}
										disabled={props.isCreatingSideChat}
										onSelect={props.onNewSideChat}
									>
										New side chat
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
					<button
						type="button"
						onClick={handleCopyId}
						className="flex items-center gap-1 border border-border px-2 py-1 text-caption text-muted-foreground transition-colors hover:border-ink hover:text-foreground"
					>
						<CopyIcon className="h-3 w-3" />
						{copied ? 'Copied' : 'ID'}
					</button>
				</ActionRow>
			</div>
		</div>
	);
}
