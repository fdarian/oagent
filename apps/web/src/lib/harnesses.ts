import { type client, orpc } from './orpc';

export type Harness = Awaited<ReturnType<typeof client.harnesses.list>>[number];
export type Backend = Harness['backend'];

export const HARNESS_NAMES: Record<Backend, string> = {
	opencode: 'OpenCode',
	cursor: 'Cursor',
	grok: 'Grok',
	codex: 'Codex',
	claude: 'Claude',
	pi: 'Pi',
};

export const BACKENDS = Object.keys(HARNESS_NAMES) as Array<Backend>;

export function isBackend(value: string): value is Backend {
	return (BACKENDS as ReadonlyArray<string>).includes(value);
}

export function harnessesQueryOptions() {
	return orpc.harnesses.list.queryOptions({
		staleTime: Infinity,
	});
}

export function harnessAuthStatusQueryOptions(backend: Backend) {
	return orpc.harnesses.authStatus.queryOptions({
		input: { backend },
		enabled: backend === 'codex',
		refetchInterval: (query) =>
			query.state.data?.status === 'pending' ? 2_000 : false,
	});
}
