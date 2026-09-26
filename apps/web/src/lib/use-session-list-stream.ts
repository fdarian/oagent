import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getEngineEndpointURL, orpc } from './orpc.ts';

export function useSessionListStream() {
	const queryClient = useQueryClient();

	useEffect(() => {
		const source = new EventSource(getEngineEndpointURL('/jobs/events'));

		source.onmessage = () => {
			void queryClient.invalidateQueries({
				queryKey: orpc.sessions.list.key(),
			});
			void queryClient.invalidateQueries({ queryKey: orpc.sessions.get.key() });
		};

		source.onerror = (error) => {
			console.error('Session list SSE error', error);
		};

		return () => {
			source.close();
		};
	}, [queryClient]);
}
