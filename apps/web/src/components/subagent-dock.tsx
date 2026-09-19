import type { ChildTimeline } from '@/lib/event-adapter';
import { formatElapsed } from '@/lib/format';
import { useClock } from '@/lib/use-clock';
import { cn } from '@/lib/utils';

export type SubagentDockProps = {
	sessions: ReadonlyMap<string, ChildTimeline>;
	activeChildSessionId: string | undefined;
	onSelect: (sessionId: string) => void;
};

function descriptionForChild(child: ChildTimeline): string {
	return child.description === undefined ? child.title : child.description;
}

export function SubagentDock(props: SubagentDockProps) {
	const running = Array.from(props.sessions.values()).filter(
		(child) => child.status === 'running',
	);
	const now = useClock(running.length > 0);
	if (running.length === 0) return null;

	return (
		<aside
			aria-label="Running subagents"
			className="shrink-0 border-primary border-t-2 bg-primary text-primary-foreground"
		>
			<div className="overflow-x-auto">
				<div className="flex min-w-max flex-nowrap">
					{running.map((child) => {
						const isActive = props.activeChildSessionId === child.id;
						return (
							<button
								type="button"
								key={child.id}
								onClick={() => props.onSelect(child.id)}
								aria-current={isActive ? 'true' : undefined}
								className={cn(
									'flex w-[min(360px,80vw)] shrink-0 flex-col gap-1 border-primary-foreground/30 border-r px-15 py-10 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-foreground/70',
									isActive
										? 'bg-primary-foreground text-primary'
										: 'hover:bg-primary-foreground/10',
								)}
							>
								<div className="flex w-full items-center justify-between gap-15 text-caption">
									{child.agentName !== undefined && (
										<span className="truncate font-medium">
											{child.agentName}
										</span>
									)}
									<span className="shrink-0 opacity-80">
										{formatElapsed(child.startedAt, now)}
									</span>
								</div>
								<span className="w-full truncate text-sm">
									{descriptionForChild(child)}
								</span>
								<span className="w-full truncate text-caption opacity-80">
									{child.lastActivity}
								</span>
							</button>
						);
					})}
				</div>
			</div>
		</aside>
	);
}
