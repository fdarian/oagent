import {
	useIsMutating,
	useMutation,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { JobHeader } from '@/components/job-header';
import { JobStatusStrip } from '@/components/job-status-strip';
import { JobTimeline } from '@/components/job-timeline';
import { SideChatDrawer } from '@/components/side-chat-drawer.tsx';
import { SubagentHeader } from '@/components/subagent-header';
import type { TimelinePart } from '@/lib/event-adapter';
import { client, orpc } from '@/lib/orpc';
import {
	isCurrentSideChatCreation,
	type SideChatCreation,
	sideChatCreateMutationFilter,
} from '@/lib/side-chat-creation.ts';
import { useJobEvents } from '@/lib/use-job-events';
import { useSessionEvents } from '@/lib/use-session-events';
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

type SessionJob = Awaited<
	ReturnType<typeof client.sessions.get>
>['jobs'][number];

export function SessionPage() {
	const params = useParams({ from: '/console/sessions/$sessionId' });
	return <SessionContent key={params.sessionId} sessionId={params.sessionId} />;
}

function SessionContent(props: { sessionId: string }) {
	const query = useQuery(
		orpc.sessions.get.queryOptions({ input: { sessionId: props.sessionId } }),
	);
	if (query.isLoading)
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				Loading session…
			</div>
		);
	if (query.isError)
		return (
			<div className="flex h-full items-center justify-center text-destructive">
				{query.error.message}
			</div>
		);
	const session = query.data;
	if (session === undefined) return null;
	const latest = session.jobs[session.jobs.length - 1];
	if (latest === undefined)
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				No jobs in this session
			</div>
		);
	return (
		<SessionConversation key={latest.id} jobs={session.jobs} latest={latest} />
	);
}

function SessionConversation(props: {
	jobs: SessionJob[];
	latest: SessionJob;
}) {
	const selectedJob = props.latest;
	const jobId = selectedJob.id;
	const search = useSearch({ from: '/console/sessions/$sessionId' });
	const navigate = useNavigate({ from: '/sessions/$sessionId' });
	const earlierJobs = props.jobs.slice(0, -1);
	const history = useSessionEvents(earlierJobs.map((job) => job.id));
	const activeChildState = useState<
		{ jobId: string; sessionId: string } | undefined
	>(undefined);
	const childSelection = activeChildState[0];
	const setChildSelection = activeChildState[1];
	const events = useJobEvents(jobId);
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
	const sideChatsQuery = useQuery(
		orpc.sideChats.list.queryOptions({
			input: { sourceJobId: jobId },
		}),
	);
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
				to: '.',
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
			queryKey: orpc.sideChats.list.key({ input: { sourceJobId: jobId } }),
		});
	}, [jobId, queryClient]);
	const sideChatTimeline = useSideChatTimeline(
		selectedSideChat,
		handleSideChatTurnTerminal,
	);

	const cancelJob = useMutation(
		orpc.jobs.cancel.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: orpc.sessions.list.key(),
				});
				void queryClient.invalidateQueries({
					queryKey: orpc.sessions.get.key(),
				});
			},
			onError: (error) => {
				console.error('Failed to cancel job', error);
			},
		}),
	);
	const createSideChat = useMutation({
		...orpc.sideChats.create.mutationOptions(),
		mutationFn: (creation: SideChatCreation) =>
			client.sideChats.create({ sourceJobId: creation.sourceJobId }),
	});
	const isCreatingSideChat =
		useIsMutating(sideChatCreateMutationFilter(jobId)) > 0;
	const sendSideChat = useMutation(
		orpc.sideChats.send.mutationOptions({
			onSuccess: async () => {
				setSideChatError(undefined);
				await queryClient.invalidateQueries({
					queryKey: orpc.sideChats.list.key({ input: { sourceJobId: jobId } }),
				});
			},
		}),
	);
	const cancelSideChatTurn = useMutation(
		orpc.jobs.cancel.mutationOptions({
			onSuccess: async () => {
				setSideChatError(undefined);
				await queryClient.invalidateQueries({
					queryKey: orpc.sideChats.list.key({ input: { sourceJobId: jobId } }),
				});
			},
			onError: (error) => {
				showSideChatError(error);
			},
		}),
	);

	const completeSideChatCreation = useCallback(
		async (creation: SideChatCreation) => {
			try {
				const sourceJobId = creation.sourceJobId;
				const sideChat = await createSideChat.mutateAsync(creation);
				await queryClient.invalidateQueries({
					queryKey: orpc.sideChats.list.key({ input: { sourceJobId } }),
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
		if (selectedJob.backend !== 'opencode') return;
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

	const activeChildSessionId = childSelection?.sessionId;
	const selectedChildEvents =
		childSelection?.jobId === jobId
			? events
			: childSelection === undefined
				? undefined
				: history[childSelection.jobId];
	const activeChild =
		activeChildSessionId === undefined || selectedChildEvents === undefined
			? undefined
			: selectedChildEvents.children.get(activeChildSessionId);

	const selectChild = (sessionId: string) => {
		setChildSelection({ jobId, sessionId });
	};

	const navigateChild = (sessionId: string | undefined) => {
		setChildSelection(
			sessionId === undefined || childSelection === undefined
				? undefined
				: { jobId: childSelection.jobId, sessionId },
		);
	};
	const jobIdForPart = (part: TimelinePart) =>
		'jobId' in part && typeof part.jobId === 'string' ? part.jobId : jobId;

	const status =
		selectedJob.status !== 'running'
			? selectedJob.status
			: events.terminal
				? events.parts.some((p) => p.kind === 'error')
					? 'error'
					: 'done'
				: selectedJob.status;
	const initialPrompt: TimelinePart & { jobId: string } = {
		kind: 'user',
		id: `${jobId}:prompt`,
		jobId,
		text: selectedJob.prompt,
		createdAt: selectedJob.createdAt,
	};
	const historyParts: TimelinePart[] = earlierJobs.flatMap((job) => [
		{
			kind: 'user' as const,
			id: `${job.id}:prompt`,
			jobId: job.id,
			text: job.prompt,
			createdAt: job.createdAt,
		},
		...(history[job.id]?.parts ?? []).map((part) => ({
			...part,
			jobId: job.id,
			id: `${job.id}:${part.id}`,
		})),
	]);
	const currentParts: TimelinePart[] = events.parts.map((part) => ({
		...part,
		jobId,
		id: `${jobId}:${part.id}`,
	}));
	const parts =
		activeChild === undefined
			? [...historyParts, initialPrompt, ...currentParts]
			: activeChild.parts;

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
						(activeChild === undefined ||
							(childSelection?.jobId === jobId &&
								activeChild.status === 'running'))
					}
				/>
			</div>
			<div className="flex min-h-0 flex-1 flex-col">
				<JobTimeline
					key={
						activeChildSessionId === undefined ? 'parent' : activeChildSessionId
					}
					parts={parts}
					streamingTail={
						activeChild === undefined
							? events.streamingTail
							: activeChild.streamingTail
					}
					cwd={selectedJob.cwd}
					childSessions={selectedChildEvents?.children ?? events.children}
					childSessionsForPart={(part) => {
						if (activeChild !== undefined) return selectedChildEvents?.children;
						const partJobId = jobIdForPart(part);
						return partJobId === jobId
							? events.children
							: history[partJobId]?.children;
					}}
					onChildSelectForPart={(part, sessionId) => {
						if (activeChild !== undefined && childSelection !== undefined) {
							setChildSelection({ jobId: childSelection.jobId, sessionId });
							return;
						}
						setChildSelection({ jobId: jobIdForPart(part), sessionId });
					}}
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
										title={selectedJob.title}
										cwd={selectedJob.cwd}
										worktreePath={selectedJob.worktreePath}
										worktreeBranch={selectedJob.worktreeBranch}
										backend={selectedJob.backend}
										model={selectedJob.model}
										agentType={selectedJob.agentType}
										sessionId={selectedJob.sessionId}
										harnessSessionId={selectedJob.harnessSessionId}
										createdAt={selectedJob.createdAt}
										terminatedAt={selectedJob.terminatedAt}
										onCancel={() => {
											cancelJob.mutate({ jobId: selectedJob.id });
										}}
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
								sessions={selectedChildEvents?.children ?? events.children}
								onNavigate={navigateChild}
							/>
						)
					}
				/>
			</div>
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
					cancelSideChatTurn.mutate({ jobId: turnJobId });
				}}
			/>
		</>
	);
}
