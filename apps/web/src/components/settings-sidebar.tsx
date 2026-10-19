import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	harnessCatalogQueryOptions,
	harnessesQueryOptions,
	useRefreshHarnesses,
} from '@/lib/harnesses';
import { cn } from '@/lib/utils';

const NAV = [
	{ label: 'Aliases', to: '/settings/aliases' as const },
	{ label: 'Agents', to: '/settings/agents' as const },
	{ label: 'Worktrees', to: '/settings/worktrees' as const },
];

const navItemClass = 'border-l px-22 py-15 text-caption transition-colors';
const activeNavItemClass =
	'border-l-ink bg-[color-mix(in_srgb,var(--color-ink)_3%,var(--color-canvas))] text-foreground dark:bg-[color-mix(in_srgb,var(--color-ink)_8%,var(--color-canvas))]';
const inactiveNavItemClass =
	'border-l-transparent text-muted-foreground hover:bg-[color-mix(in_srgb,var(--color-ink)_1%,var(--color-canvas))] hover:text-foreground dark:hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,var(--color-canvas))]';

export function SettingsSidebar() {
	const harnessesQuery = useQuery(harnessesQueryOptions());
	const catalogQuery = useQuery(harnessCatalogQueryOptions());
	const refreshMutation = useRefreshHarnesses();

	const catalog = catalogQuery.data ?? [];
	const detectedBackends = new Set(
		(harnessesQuery.data ?? []).map((harness) => harness.backend),
	);
	// Saved harnesses stay listed even when their binary is missing so they can be fixed.
	const listedHarnesses = catalog.filter(
		(entry) => !entry.builtin || detectedBackends.has(entry.id),
	);
	const isLoading = harnessesQuery.isLoading || catalogQuery.isLoading;
	const isError = harnessesQuery.isError || catalogQuery.isError;

	return (
		<nav className="flex min-h-0 flex-1 flex-col border-t border-border">
			{NAV.map((item) => (
				<Link
					key={item.to}
					to={item.to}
					activeProps={{
						className: activeNavItemClass,
					}}
					inactiveProps={{
						className: inactiveNavItemClass,
					}}
					className={cn(navItemClass)}
				>
					{item.label}
				</Link>
			))}

			<div className="flex items-center justify-between px-22 pb-8 pt-22">
				<span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
					Harnesses
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					disabled={refreshMutation.isPending}
					onClick={() => refreshMutation.mutate()}
					aria-label="Refresh harnesses"
					title="Refresh harnesses"
				>
					<RefreshCw
						className={refreshMutation.isPending ? 'animate-spin' : undefined}
					/>
				</Button>
			</div>

			{isLoading ? (
				<p className="px-22 pb-15 text-caption text-muted-foreground">
					Loading harnesses…
				</p>
			) : isError ? (
				<p className="px-22 pb-15 text-caption text-destructive">
					Failed to load harnesses
				</p>
			) : listedHarnesses.length === 0 ? (
				<p className="px-22 pb-15 text-caption text-muted-foreground">
					No harnesses detected.
				</p>
			) : (
				listedHarnesses.map((harness) => (
					<Link
						key={harness.id}
						to="/settings/harnesses/$backend"
						params={{ backend: harness.id }}
						activeProps={{ className: activeNavItemClass }}
						inactiveProps={{ className: inactiveNavItemClass }}
						className={cn(navItemClass)}
					>
						{harness.name}
					</Link>
				))
			)}

			<Link
				to="/settings/acp-harnesses/new"
				activeProps={{ className: activeNavItemClass }}
				inactiveProps={{ className: inactiveNavItemClass }}
				className={cn(navItemClass, 'flex items-center gap-2')}
			>
				<Plus className="size-3.5" />
				Add ACP harness
			</Link>
		</nav>
	);
}
