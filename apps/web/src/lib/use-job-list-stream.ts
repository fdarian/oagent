import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getEngineEndpointURL, orpc } from './orpc.ts';

export function useJobListStream() {
	const queryClient = useQueryClient();

	useEffect(() => {
		const source = new EventSource(getEngineEndpointURL('/jobs/events'));

		source.onmessage = () => {
			queryClient.invalidateQueries({ queryKey: orpc.jobs.list.key() });
		};

		source.onerror = (error) => {
			console.error('Job list SSE error', error);
		};

		return () => {
			source.close();
		};
	}, [queryClient]);
}
