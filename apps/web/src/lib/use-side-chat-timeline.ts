import { useEffect, useMemo } from 'react';
import {
	createSideChatTimeline,
	getRunningSideChatTurn,
	type SideChat,
} from '@/lib/side-chat-timeline.ts';
import { useJobEvents } from '@/lib/use-job-events.ts';

export function useSideChatTimeline(
	sideChat: SideChat | undefined,
	onTurnReconcile: (jobId: string) => void,
) {
	const activeTurn = getRunningSideChatTurn(sideChat);
	const activeTurnId = activeTurn?.id;
	const activeEvents = useJobEvents(activeTurnId, onTurnReconcile);
	const eventsForActiveTurn =
		activeEvents.jobId === activeTurnId ? activeEvents : undefined;

	useEffect(() => {
		if (activeTurnId === undefined || !eventsForActiveTurn?.terminal) return;
		onTurnReconcile(activeTurnId);
	}, [activeTurnId, eventsForActiveTurn?.terminal, onTurnReconcile]);

	return useMemo(
		() => createSideChatTimeline(sideChat, eventsForActiveTurn),
		[eventsForActiveTurn, sideChat],
	);
}
