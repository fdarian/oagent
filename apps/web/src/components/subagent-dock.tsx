import type { ChildTimeline } from '@/lib/event-adapter';
import { formatElapsed } from '@/lib/format';
import { stripChildTitlePrefix } from '@/lib/subagent-title';
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
			className="shrink-0 border-primary border-t bg-primary/5 text-foreground"
		>
			<div className="overflow-x-auto p-2">
				<div className="flex min-w-max flex-nowrap gap-2">
					{running.map((child) => {
						const isActive = props.activeChildSessionId === child.id;
						return (
							<button
								type="button"
								key={child.id}
								onClick={() => props.onSelect(child.id)}
								aria-current={isActive ? 'true' : undefined}
								className={cn(
									'flex w-fit min-w-[220px] max-w-[min(320px,80vw)] shrink-0 flex-col gap-1 border border-primary/30 bg-background/80 px-15 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
									isActive
										? 'border-primary bg-primary/10'
										: 'hover:bg-primary/10',
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
								<span className="w-full truncate text-caption text-muted-foreground">
									{stripChildTitlePrefix(
										child.lastActivity,
										child.title,
										child.description,
									)}
								</span>
							</button>
						);
					})}
				</div>
			</div>
		</aside>
	);
}
