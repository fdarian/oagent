import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { type client, orpc } from './orpc';

export type Harness = Awaited<ReturnType<typeof client.harnesses.list>>[number];
export type HarnessCatalogEntry = Awaited<
	ReturnType<typeof client.harnesses.catalog>
>[number];
export type CustomHarness = Awaited<
	ReturnType<typeof client.customHarnesses.list>
>[number];

export const INLINE_ACP_HARNESS_ID = 'acp';

/**
 * Mirrors the engine's `CUSTOM_HARNESS_ID_PATTERN`. The web bundle only
 * type-imports `@oagent/engine`, so the runtime constant cannot be shared.
 */
export const CUSTOM_HARNESS_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export function harnessCatalogQueryOptions() {
	return orpc.harnesses.catalog.queryOptions({
		staleTime: Infinity,
	});
}

export function customHarnessesQueryOptions() {
	return orpc.customHarnesses.list.queryOptions({
		staleTime: Infinity,
	});
}

export function harnessesQueryOptions() {
	return orpc.harnesses.list.queryOptions({
		staleTime: Infinity,
	});
}

export function harnessLabel(
	catalog: ReadonlyArray<HarnessCatalogEntry> | undefined,
	id: string,
): string {
	if (id === INLINE_ACP_HARNESS_ID) return 'ACP';
	const entry = catalog?.find((candidate) => candidate.id === id);
	return entry === undefined ? id : entry.name;
}

/** Resolves display names from the engine catalog; unknown ids render as-is. */
export function useHarnessName(): (id: string) => string {
	const catalogQuery = useQuery(harnessCatalogQueryOptions());
	return (id) => harnessLabel(catalogQuery.data, id);
}

export function formatAcpCommand(command: {
	binary: string;
	args: ReadonlyArray<string>;
}): string {
	return [command.binary, ...command.args]
		.map((part) => (/[\s"']/.test(part) ? JSON.stringify(part) : part))
		.join(' ');
}

export function useRefreshHarnesses() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.harnesses.refresh.mutationOptions({
			onSuccess: (harnesses) => {
				queryClient.setQueryData(orpc.harnesses.list.queryKey(), harnesses);
			},
		}),
	);
}

/** Saved harnesses feed every harness picker, so any change refetches them all. */
export async function invalidateCustomHarnesses(queryClient: QueryClient) {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: orpc.harnesses.catalog.key() }),
		queryClient.invalidateQueries({
			queryKey: orpc.customHarnesses.list.key(),
		}),
		queryClient.invalidateQueries({ queryKey: orpc.models.list.key() }),
	]);
}

export function codexAuthStatusQueryOptions() {
	return orpc.harnesses.authStatus.queryOptions({
		input: { backend: 'codex' },
		refetchInterval: (query) =>
			query.state.data?.status === 'pending' ? 2_000 : false,
	});
}
