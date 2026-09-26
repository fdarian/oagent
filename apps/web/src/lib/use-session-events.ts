import { useEffect, useState } from 'react';
import { type JobEventsState, subscribeJobEvents } from './use-job-events.ts';

export function useSessionEvents(
	jobIds: string[],
): Record<string, JobEventsState> {
	const [events, setEvents] = useState<Record<string, JobEventsState>>({});
	const idsKey = jobIds.join('\0');
	useEffect(() => {
		setEvents({});
		const ids = idsKey === '' ? [] : idsKey.split('\0');
		const cleanups = ids.map((jobId) =>
			subscribeJobEvents(jobId, (state) => {
				setEvents((previous) => ({ ...previous, [jobId]: state }));
			}),
		);
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	}, [idsKey]);
	return events;
}
