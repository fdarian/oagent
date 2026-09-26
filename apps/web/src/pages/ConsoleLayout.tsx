import { Outlet, useMatch } from '@tanstack/react-router';
import { SessionSidebar } from '@/components/session-sidebar';
import { useSessionList } from '@/lib/use-session-list';

export function ConsoleLayout() {
	const sessionList = useSessionList();
	const sessionMatch = useMatch({
		from: '/console/sessions/$sessionId',
		shouldThrow: false,
	});
	const selectedId = sessionMatch?.params.sessionId;

	return (
		<div className="flex h-screen w-screen flex-col overflow-hidden bg-background sm:flex-row">
			<SessionSidebar
				grouped={sessionList.grouped}
				selectedId={selectedId}
				isLoading={sessionList.isLoading}
				cwdFilter={sessionList.cwdFilter}
				onCwdFilterChange={sessionList.setCwdFilter}
			/>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<Outlet />
			</div>
		</div>
	);
}
