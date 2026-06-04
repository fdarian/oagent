import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from './query-keys';

export function useJobListStream() {
	const queryClient = useQueryClient();

	useEffect(() => {
		const source = new EventSource('/jobs/events');

		source.onmessage = () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
		};

		source.onerror = (error) => {
			console.error('Job list SSE error', error);
		};

		return () => {
			source.close();
		};
	}, [queryClient]);
}
