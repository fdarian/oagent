import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { orpc } from '@/lib/orpc';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

const NAV = [
	{ label: 'Aliases', to: '/settings/aliases' as const },
	{ label: 'Timeout', to: '/settings/timeout' as const },
];

type Backend = 'opencode' | 'cursor' | 'grok' | 'codex';

const HARNESS_NAMES: Record<Backend, string> = {
	opencode: 'OpenCode',
	cursor: 'Cursor',
	grok: 'Grok',
	codex: 'Codex',
};

const navItemClass = 'border-l px-22 py-15 text-caption transition-colors';
const activeNavItemClass =
	'border-l-ink bg-[color-mix(in_srgb,var(--color-ink)_3%,var(--color-canvas))] text-foreground dark:bg-[color-mix(in_srgb,var(--color-ink)_8%,var(--color-canvas))]';
const inactiveNavItemClass =
	'border-l-transparent text-muted-foreground hover:bg-[color-mix(in_srgb,var(--color-ink)_1%,var(--color-canvas))] hover:text-foreground dark:hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,var(--color-canvas))]';

function isBackend(value: string): value is Backend {
	return (
		value === 'opencode' ||
		value === 'cursor' ||
		value === 'grok' ||
		value === 'codex'
	);
}

export function SettingsSidebar() {
	const queryClient = useQueryClient();
	const harnessesQuery = useQuery({
		queryKey: queryKeys.harnesses(),
		queryFn: () => orpc.harnesses.list(),
		staleTime: Infinity,
	});
	const refreshMutation = useMutation({
		mutationFn: () => orpc.harnesses.refresh(),
		onSuccess: (harnesses) => {
			queryClient.setQueryData(queryKeys.harnesses(), harnesses);
		},
	});

	const detectedHarnesses = (harnessesQuery.data ?? []).filter((harness) =>
		isBackend(harness.backend),
	);

	return (
		<nav className="flex flex-col border-t border-border">
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

			{harnessesQuery.isLoading ? (
				<p className="px-22 pb-15 text-caption text-muted-foreground">
					Loading harnesses…
				</p>
			) : harnessesQuery.isError ? (
				<p className="px-22 pb-15 text-caption text-destructive">
					Failed to load harnesses
				</p>
			) : detectedHarnesses.length === 0 ? (
				<p className="px-22 pb-15 text-caption text-muted-foreground">
					No harnesses detected.
				</p>
			) : (
				detectedHarnesses.map((harness) => (
					<Link
						key={harness.backend}
						to="/settings/harnesses/$backend"
						params={{ backend: harness.backend }}
						activeProps={{ className: activeNavItemClass }}
						inactiveProps={{ className: inactiveNavItemClass }}
						className={cn(navItemClass)}
					>
						{HARNESS_NAMES[harness.backend]}
					</Link>
				))
			)}
		</nav>
	);
}
