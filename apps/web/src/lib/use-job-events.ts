import { useEffect, useRef, useState } from 'react';
import { reduceEvents, type TimelinePart } from './event-adapter.ts';

export type JobEventsState = {
	parts: TimelinePart[];
	lastStatus?: string;
	terminal: boolean;
	isLoading: boolean;
};

export function useJobEvents(jobId: string | undefined): JobEventsState {
	const [result, setResult] = useState<JobEventsState>({
		parts: [],
		terminal: false,
		isLoading: false,
	});
	const eventsRef = useRef<Parameters<typeof reduceEvents>[0]>([]);

	useEffect(() => {
		eventsRef.current = [];
		setResult({
			parts: [],
			terminal: false,
			isLoading: jobId !== undefined,
		});

		if (jobId === undefined) {
			return;
		}

		const source = new EventSource(`/jobs/${jobId}/events`);

		source.onmessage = (e) => {
			const data = JSON.parse(e.data);
			if (data === '__terminal__') {
				source.close();
				setResult((prev) => ({
					...prev,
					terminal: true,
					isLoading: false,
				}));
				return;
			}
			eventsRef.current = [...eventsRef.current, data];
			const next = reduceEvents(eventsRef.current);
			setResult({
				parts: next.parts,
				lastStatus: next.lastStatus,
				terminal: false,
				isLoading: false,
			});
		};

		source.onerror = () => {
			source.close();
			setResult((prev) => ({ ...prev, isLoading: false }));
		};

		return () => {
			source.close();
		};
	}, [jobId]);

	return result;
}
