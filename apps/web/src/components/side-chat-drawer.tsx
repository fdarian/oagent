import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { PlusIcon, XCircleIcon, XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { JobTimeline } from '@/components/job-timeline.tsx';
import { SideChatComposer } from '@/components/side-chat-composer.tsx';
import type { SideChat, SideChatTimeline } from '@/lib/side-chat-timeline.ts';
import { ActionRow } from './ui/action-row';

export type SideChatDrawerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	finalFocus?: React.ComponentProps<typeof DialogPrimitive.Popup>['finalFocus'];
	cwd: string;
	sideChats: SideChat[] | undefined;
	selectedSideChatId?: string;
	onSelectSideChat: (sideChatId: string) => void;
	onCreate: () => void;
	isCreating: boolean;
	isLoading: boolean;
	unsupportedMessage?: string;
	errorMessage?: string;
	timeline: SideChatTimeline | undefined;
	onSend: (text: string) => Promise<void>;
	onSubmitError: (error: unknown) => void;
	isSending: boolean;
	onCancelTurn?: (jobId: string) => void;
};

function DrawerMessage(props: {
	children: ReactNode;
	variant?: 'error' | 'info';
}) {
	const variant = props.variant === undefined ? 'info' : props.variant;
	return (
		<div
			role={variant === 'error' ? 'alert' : undefined}
			className={
				variant === 'error'
					? 'border border-destructive bg-destructive/5 px-15 py-10 text-caption text-destructive'
					: 'border border-border px-15 py-10 text-caption text-muted-foreground'
			}
		>
			{props.children}
		</div>
	);
}

export function SideChatDrawer(props: SideChatDrawerProps) {
	const [closedSideChatIds, setClosedSideChatIds] = useState<Set<string>>(
		() => new Set(),
	);
	useEffect(() => {
		if (!props.open) setClosedSideChatIds(new Set());
	}, [props.open]);

	const visibleSideChats =
		props.sideChats === undefined
			? undefined
			: props.sideChats.filter(
					(sideChat) => !closedSideChatIds.has(sideChat.id),
				);
	const hasSideChats =
		visibleSideChats !== undefined && visibleSideChats.length > 0;
	const isUnsupported = props.unsupportedMessage !== undefined;
	const isTurnRunning = props.timeline?.isRunning === true;
	const handleCloseSideChat = (sideChatId: string) => {
		if (visibleSideChats === undefined) return;
		const sideChatIndex = visibleSideChats.findIndex(
			(sideChat) => sideChat.id === sideChatId,
		);
		if (sideChatIndex < 0) return;

		const remainingSideChats = visibleSideChats.filter(
			(sideChat) => sideChat.id !== sideChatId,
		);
		setClosedSideChatIds((previous) => {
			const next = new Set(previous);
			next.add(sideChatId);
			return next;
		});

		if (sideChatId !== props.selectedSideChatId) return;
		const nextSideChat =
			remainingSideChats[sideChatIndex] ??
			remainingSideChats[sideChatIndex - 1];
		if (nextSideChat === undefined) {
			props.onOpenChange(false);
			return;
		}
		props.onSelectSideChat(nextSideChat.id);
	};

	return (
		<DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/35 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0" />
				<DialogPrimitive.Popup
					finalFocus={props.finalFocus}
					className="fixed inset-y-0 right-0 z-50 flex min-h-0 w-full max-w-[min(44rem,100vw)] flex-col overflow-hidden border-l border-border bg-background shadow-xl outline-none data-closed:animate-out data-closed:slide-out-to-right data-open:animate-in data-open:slide-in-from-right"
				>
					<div className="flex shrink-0 items-center justify-between gap-10 border-b border-border px-22 py-15">
						<div className="min-w-0 flex-1">
							<DialogPrimitive.Title className="text-subheading font-light text-foreground">
								Side chats
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="mt-1 text-caption text-muted-foreground">
								Forked conversations stay separate from the main job.
							</DialogPrimitive.Description>
						</div>
						<ActionRow size="sm">
							{!isUnsupported && (
								<button
									type="button"
									onClick={props.onCreate}
									disabled={props.isCreating}
									className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap border border-border px-2 text-caption text-muted-foreground transition-colors hover:border-ink hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
								>
									<PlusIcon className="size-3" />
									New side chat
								</button>
							)}
							<DialogPrimitive.Close
								render={<button type="button" />}
								className="flex size-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
								aria-label="Close side chats"
							>
								<XIcon className="size-4" />
							</DialogPrimitive.Close>
						</ActionRow>
					</div>

					{isUnsupported ? (
						<div className="p-22">
							<DrawerMessage variant="error">
								{props.unsupportedMessage}
							</DrawerMessage>
						</div>
					) : (
						<>
							<div className="flex min-h-0 min-w-0 flex-1 flex-col">
								{props.errorMessage !== undefined && (
									<div className="shrink-0 px-22 pt-15">
										<DrawerMessage variant="error">
											{props.errorMessage}
										</DrawerMessage>
									</div>
								)}
								{hasSideChats && (
									<div className="shrink-0 border-b border-border px-22 pt-2">
										<fieldset
											aria-label="Side chats"
											className="flex min-w-0 max-w-full gap-1 overflow-x-auto border-0 p-0"
										>
											{visibleSideChats?.map((sideChat, index) => (
												<div
													key={sideChat.id}
													className="group relative flex shrink-0"
												>
													<button
														type="button"
														aria-pressed={
															sideChat.id === props.selectedSideChatId
														}
														onClick={() => props.onSelectSideChat(sideChat.id)}
														className={
															sideChat.id === props.selectedSideChatId
																? 'shrink-0 border-b-2 border-foreground px-3 py-1 text-caption text-foreground'
																: 'shrink-0 border-b-2 border-transparent px-3 py-1 text-caption text-muted-foreground transition-colors hover:text-foreground'
														}
													>
														<span className="max-w-32 truncate group-hover:mask-r-from-[calc(100%-2.25rem)] group-hover:mask-r-to-[calc(100%-0.75rem)]">
															Chat {index + 1}
														</span>
													</button>
													<button
														type="button"
														aria-label={`Close Chat ${index + 1}`}
														onClick={() => handleCloseSideChat(sideChat.id)}
														className="absolute top-1/2 right-0.5 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none"
													>
														<XIcon className="size-3" />
													</button>
												</div>
											))}
										</fieldset>
									</div>
								)}

								{props.isLoading && props.sideChats === undefined ? (
									<div className="flex min-h-0 flex-1 items-center justify-center px-22 text-caption text-muted-foreground">
										Loading side chats…
									</div>
								) : !hasSideChats ? (
									<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-15 px-22 text-center">
										<p className="text-body font-light text-foreground">
											Start a separate conversation from this job.
										</p>
										<button
											type="button"
											onClick={props.onCreate}
											disabled={props.isCreating}
											className="flex items-center gap-1 border border-border px-3 py-2 text-caption text-muted-foreground transition-colors hover:border-ink hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
										>
											<PlusIcon className="size-3" />
											New side chat
										</button>
									</div>
								) : props.timeline === undefined ? (
									<div className="flex min-h-0 flex-1 items-center justify-center px-22 text-caption text-muted-foreground">
										Select a side chat to view it.
									</div>
								) : (
									<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-5">
										<JobTimeline
											parts={props.timeline.parts}
											streamingTail={props.timeline.streamingTail}
											cwd={props.cwd}
											contentClassName="px-22"
											isLoading={props.isLoading}
										/>
									</div>
								)}
							</div>

							{props.selectedSideChatId !== undefined &&
								props.timeline !== undefined && (
									<div className="shrink-0 border-t border-border p-15">
										{isTurnRunning && (
											<div className="mb-2 flex items-center justify-between gap-10">
												<span className="text-caption text-muted-foreground">
													Waiting for the current turn to finish
												</span>
												{props.timeline?.activeTurnId !== undefined &&
													props.onCancelTurn !== undefined && (
														<button
															type="button"
															onClick={() => {
																const activeTurnId =
																	props.timeline?.activeTurnId;
																if (
																	activeTurnId !== undefined &&
																	props.onCancelTurn !== undefined
																) {
																	props.onCancelTurn(activeTurnId);
																}
															}}
															className="flex items-center gap-1 text-caption text-destructive transition-colors hover:text-foreground"
														>
															<XCircleIcon className="size-3" />
															Cancel turn
														</button>
													)}
											</div>
										)}
										<SideChatComposer
											key={props.selectedSideChatId}
											disabled={props.isSending || isTurnRunning}
											onSubmit={props.onSend}
											onError={props.onSubmitError}
										/>
									</div>
								)}
						</>
					)}
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
