import {
	useIsMutating,
	useMutation,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { JobHeader } from '@/components/job-header';
import { JobPromptView } from '@/components/job-prompt-view';
import { JobStatusStrip } from '@/components/job-status-strip';
import { JobTimeline } from '@/components/job-timeline';
import { SideChatDrawer } from '@/components/side-chat-drawer.tsx';
import { SubagentHeader } from '@/components/subagent-header';
import { orpc } from '@/lib/orpc';
import { queryKeys } from '@/lib/query-keys';
import {
	isCurrentSideChatCreation,
	type SideChatCreation,
	sideChatCreateMutationFilter,
	sideChatCreateMutationKey,
} from '@/lib/side-chat-creation.ts';
import { useJobEvents } from '@/lib/use-job-events';
import { useSideChatTimeline } from '@/lib/use-side-chat-timeline.ts';

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

type SideChatError = {
	jobId: string;
	message: string;
	sideChatId?: string;
};

export function JobDetailPage() {
	const params = useParams({ from: '/console/jobs/$jobId' });
	return <JobDetailPageForJob key={params.jobId} jobId={params.jobId} />;
}

type JobDetailPageForJobProps = {
	jobId: string;
};

function JobDetailPageForJob(props: JobDetailPageForJobProps) {
	const jobId = props.jobId;
	const search = useSearch({ from: '/console/jobs/$jobId' });
	const navigate = useNavigate({ from: '/jobs/$jobId' });
	const [isPromptExpanded, setIsPromptExpanded] = useState(false);
	const activeChildState = useState<
		{ jobId: string; sessionId: string } | undefined
	>(undefined);
	const childSelection = activeChildState[0];
	const setChildSelection = activeChildState[1];
	const selectedJobQuery = useQuery({
		queryKey: queryKeys.job(jobId),
		queryFn: () => orpc.jobs.get({ jobId }),
	});
	const selectedJob = selectedJobQuery.data;
	const events = useJobEvents(selectedJob?.id);
	const queryClient = useQueryClient();
	const [drawerState, setDrawerState] = useState({
		sourceJobId: jobId,
		drawerInstance: 0,
		open: false,
	});
	const [sideChatError, setSideChatError] = useState<SideChatError | undefined>(
		undefined,
	);
	const moreTriggerRef = useRef<HTMLButtonElement>(null);
	const previousSideChatIdRef = useRef(search.sideChat);
	const drawerInstanceRef = useRef(0);
	const currentSideChatIdRef = useRef(search.sideChat);
	const isSideChatCreationActiveRef = useRef(true);
	currentSideChatIdRef.current = search.sideChat;
	if (previousSideChatIdRef.current !== search.sideChat) {
		previousSideChatIdRef.current = search.sideChat;
		drawerInstanceRef.current += 1;
	}
	useEffect(() => {
		isSideChatCreationActiveRef.current = true;
		return () => {
			isSideChatCreationActiveRef.current = false;
		};
	}, []);
	const sideChatsQuery = useQuery({
		queryKey: queryKeys.sideChats(jobId),
		queryFn: () => orpc.sideChats.list({ sourceJobId: jobId }),
		enabled: selectedJob !== undefined,
	});
	const sideChats = sideChatsQuery.data;
	const selectedSideChat =
		sideChats === undefined || search.sideChat === undefined
			? undefined
			: sideChats.find((sideChat) => sideChat.id === search.sideChat);
	const beginDrawerInstance = useCallback(() => {
		drawerInstanceRef.current += 1;
		return drawerInstanceRef.current;
	}, []);
	const isCurrentDrawerCreation = useCallback(
		(creation: SideChatCreation) => {
			if (!isSideChatCreationActiveRef.current) return false;
			return isCurrentSideChatCreation({
				creation,
				currentJobId: jobId,
				currentDrawerInstance: drawerInstanceRef.current,
			});
		},
		[jobId],
	);
	const showSideChatError = useCallback(
		(error: unknown) => {
			const sourceJobId = jobId;
			const sideChatId = search.sideChat;
			if (
				!isSideChatCreationActiveRef.current ||
				currentSideChatIdRef.current !== sideChatId
			) {
				return;
			}
			setSideChatError({
				jobId: sourceJobId,
				message: getErrorMessage(error),
				sideChatId,
			});
		},
		[jobId, search.sideChat],
	);
	const selectSideChat = useCallback(
		(sideChatId: string | undefined) => {
			if (!isSideChatCreationActiveRef.current) return;
			const drawerInstance = beginDrawerInstance();
			setSideChatError(undefined);
			setDrawerState({ sourceJobId: jobId, drawerInstance, open: false });
			void navigate({
				search: (previous) => ({ ...previous, sideChat: sideChatId }),
			});
		},
		[beginDrawerInstance, jobId, navigate],
	);
	const handleDrawerOpenChange = useCallback(
		(open: boolean) => {
			if (!isSideChatCreationActiveRef.current) return;
			if (open) {
				const drawerInstance = beginDrawerInstance();
				setSideChatError(undefined);
				if (search.sideChat === undefined) {
					setDrawerState({ sourceJobId: jobId, drawerInstance, open: true });
				}
				return;
			}
			selectSideChat(undefined);
		},
		[beginDrawerInstance, jobId, search.sideChat, selectSideChat],
	);
	const handleDrawerCloseAutoFocus = useCallback(() => {
		if (!isSideChatCreationActiveRef.current) return;
		moreTriggerRef.current?.focus();
	}, []);

	useEffect(() => {
		setSideChatError((previous) =>
			previous?.jobId === jobId && previous.sideChatId === search.sideChat
				? previous
				: undefined,
		);
	}, [jobId, search.sideChat]);

	const handleSideChatTurnTerminal = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: queryKeys.sideChats(jobId),
		});
	}, [jobId, queryClient]);
	const sideChatTimeline = useSideChatTimeline(
		selectedSideChat,
		handleSideChatTurnTerminal,
	);

	const cancelJob = useMutation({
		mutationFn: (id: string) => orpc.jobs.cancel({ jobId: id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
		},
		onError: (error) => {
			console.error('Failed to cancel job', error);
		},
	});
	const createSideChat = useMutation({
		mutationKey: sideChatCreateMutationKey,
		mutationFn: (creation: SideChatCreation) =>
			orpc.sideChats.create({ sourceJobId: creation.sourceJobId }),
	});
	const isCreatingSideChat =
		useIsMutating(sideChatCreateMutationFilter(jobId)) > 0;
	const sendSideChat = useMutation({
		mutationFn: (input: { sideChatId: string; prompt: string }) =>
			orpc.sideChats.send(input),
		onSuccess: async () => {
			setSideChatError(undefined);
			await queryClient.invalidateQueries({
				queryKey: queryKeys.sideChats(jobId),
			});
		},
	});
	const cancelSideChatTurn = useMutation({
		mutationFn: (turnJobId: string) => orpc.jobs.cancel({ jobId: turnJobId }),
		onSuccess: async () => {
			setSideChatError(undefined);
			await queryClient.invalidateQueries({
				queryKey: queryKeys.sideChats(jobId),
			});
		},
		onError: (error) => {
			showSideChatError(error);
		},
	});

	const completeSideChatCreation = useCallback(
		async (creation: SideChatCreation) => {
			try {
				const sourceJobId = creation.sourceJobId;
				const sideChat = await createSideChat.mutateAsync(creation);
				await queryClient.invalidateQueries({
					queryKey: queryKeys.sideChats(sourceJobId),
					refetchType: 'all',
				});
				if (!isCurrentDrawerCreation(creation)) return;
				selectSideChat(sideChat.id);
			} catch (error) {
				if (!isCurrentDrawerCreation(creation)) return;
				showSideChatError(error);
			}
		},
		[
			createSideChat,
			isCurrentDrawerCreation,
			queryClient,
			selectSideChat,
			showSideChatError,
		],
	);
	const handleNewSideChat = useCallback(() => {
		if (!isSideChatCreationActiveRef.current || isCreatingSideChat) return;
		const creation = {
			sourceJobId: jobId,
			drawerInstance: beginDrawerInstance(),
		};
		setDrawerState({
			sourceJobId: jobId,
			drawerInstance: creation.drawerInstance,
			open: true,
		});
		setSideChatError(undefined);
		if (selectedJob === undefined || selectedJob.backend !== 'opencode') return;
		void completeSideChatCreation(creation);
	}, [
		beginDrawerInstance,
		completeSideChatCreation,
		isCreatingSideChat,
		jobId,
		selectedJob,
	]);
	const handleOpenSideChats = useCallback(() => {
		const firstSideChat = sideChats?.[0];
		if (firstSideChat === undefined) return;
		setSideChatError(undefined);
		selectSideChat(firstSideChat.id);
	}, [selectSideChat, sideChats]);

	const handleSendSideChat = useCallback(
		async (prompt: string) => {
			if (selectedSideChat === undefined) {
				throw new Error('Select a side chat before sending a message.');
			}
			setSideChatError(undefined);
			await sendSideChat.mutateAsync({
				sideChatId: selectedSideChat.id,
				prompt,
			});
		},
		[selectedSideChat, sendSideChat],
	);

	const handleSideChatSubmitError = showSideChatError;
	const sideChatsQueryError =
		sideChatsQuery.error === null
			? undefined
			: getErrorMessage(sideChatsQuery.error);
	const selectedSideChatError =
		sideChatError?.jobId === jobId &&
		sideChatError.sideChatId === search.sideChat
			? sideChatError
			: undefined;
	const drawerError =
		selectedSideChatError === undefined
			? sideChatsQueryError
			: selectedSideChatError.message;
	const drawerOpen =
		search.sideChat !== undefined ||
		(drawerState.sourceJobId === jobId &&
			drawerState.drawerInstance === drawerInstanceRef.current &&
			drawerState.open);

	if (selectedJobQuery.isLoading) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-22 text-muted-foreground">
				<p className="text-body font-light">Loading job…</p>
			</div>
		);
	}

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
						activeChildSessionId={activeChildSessionId}
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
											worktreePath={selectedJob.worktreePath}
											worktreeBranch={selectedJob.worktreeBranch}
											backend={selectedJob.backend}
											model={selectedJob.model}
											agentType={selectedJob.agentType}
											sessionId={selectedJob.sessionId}
											createdAt={selectedJob.createdAt}
											terminatedAt={selectedJob.terminatedAt}
											onCancel={() => {
												cancelJob.mutate(selectedJob.id);
											}}
											onExpandPrompt={() => setIsPromptExpanded(true)}
											onNewSideChat={handleNewSideChat}
											isCreatingSideChat={isCreatingSideChat}
											onOpenSideChats={
												sideChats === undefined || sideChats.length === 0
													? undefined
													: handleOpenSideChats
											}
											moreTriggerRef={moreTriggerRef}
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
				</div>
			)}
			<SideChatDrawer
				key={jobId}
				open={drawerOpen}
				onOpenChange={handleDrawerOpenChange}
				onCloseAutoFocus={handleDrawerCloseAutoFocus}
				cwd={selectedJob.cwd}
				sideChats={sideChats}
				selectedSideChatId={search.sideChat}
				onSelectSideChat={selectSideChat}
				onCreate={handleNewSideChat}
				isCreating={isCreatingSideChat}
				isLoading={sideChatsQuery.isLoading}
				unsupportedMessage={
					selectedJob.backend === 'opencode'
						? undefined
						: `Side chats are currently available only for OpenCode jobs. This job uses the ${selectedJob.backend} harness.`
				}
				errorMessage={drawerError}
				timeline={selectedSideChat === undefined ? undefined : sideChatTimeline}
				onSend={handleSendSideChat}
				onSubmitError={handleSideChatSubmitError}
				isSending={sendSideChat.isPending}
				onCancelTurn={(turnJobId) => {
					cancelSideChatTurn.mutate(turnJobId);
				}}
			/>
		</>
	);
}
