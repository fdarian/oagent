import { Link, Outlet } from '@tanstack/react-router';
import { SettingsSidebar } from '@/components/settings-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';

export function SettingsLayout() {
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
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<Outlet />
			</div>
		</div>
	);
}
