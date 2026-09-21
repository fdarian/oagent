import { Link, Outlet } from '@tanstack/react-router';
import { SettingsSidebar } from '@/components/settings-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';

export function SettingsLayout() {
	const buildCommit = import.meta.env.VITE_BUILD_COMMIT;

	return (
		<div className="flex h-screen w-screen overflow-hidden bg-background">
			<div className="flex h-full w-[280px] shrink-0 flex-col border-r border-border bg-background">
				<div className="flex items-center justify-between px-22 py-15">
					<Link
						to="/"
						className="text-subheading font-light text-foreground hover:text-primary"
					>
						oagent
					</Link>
					<ThemeToggle />
				</div>
				<SettingsSidebar />
				{buildCommit !== undefined ? (
					<div className="border-t border-border px-22 py-15 text-xs text-muted-foreground">
						<span>Commit </span>
						<span className="font-mono" title={buildCommit}>
							{buildCommit.slice(0, 7)}
						</span>
					</div>
				) : null}
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<Outlet />
			</div>
		</div>
	);
}
