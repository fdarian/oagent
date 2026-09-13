import { orpc } from './orpc';
import { queryKeys } from './query-keys';

export type Harness = Awaited<ReturnType<typeof orpc.harnesses.list>>[number];
export type Backend = Harness['backend'];

export const HARNESS_NAMES: Record<Backend, string> = {
	opencode: 'OpenCode',
	cursor: 'Cursor',
	grok: 'Grok',
	codex: 'Codex',
};

export function isBackend(value: string): value is Backend {
	return (
		value === 'opencode' ||
		value === 'cursor' ||
		value === 'grok' ||
		value === 'codex'
	);
}

export function harnessesQueryOptions() {
	return {
		queryKey: queryKeys.harnesses(),
		queryFn: () => orpc.harnesses.list(),
		staleTime: Infinity,
	};
}
