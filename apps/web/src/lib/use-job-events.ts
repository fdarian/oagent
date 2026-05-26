import { useEffect, useRef, useState } from 'react';
import {
	applyEvent,
	createInitialState,
	finalizeState,
	type ReduceState,
	type TimelinePart,
	toDisplayState,
} from './event-adapter.ts';

export type JobEventsState = {
	parts: TimelinePart[];
	streamingTail: TimelinePart | null;
	lastStatus?: string;
	terminal: boolean;
	isLoading: boolean;
};

export function useJobEvents(jobId: string | undefined): JobEventsState {
	const [result, setResult] = useState<JobEventsState>({
		parts: [],
		streamingTail: null,
		terminal: false,
		isLoading: false,
	});
	const stateRef = useRef<ReduceState>(createInitialState());

	useEffect(() => {
		stateRef.current = createInitialState();
		setResult({
			parts: [],
			streamingTail: null,
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
				const final = finalizeState(stateRef.current);
				setResult({
					parts: final.parts,
					streamingTail: null,
					lastStatus: final.lastStatus,
					terminal: true,
					isLoading: false,
				});
				return;
			}
			stateRef.current = applyEvent(stateRef.current, data, Date.now());
			const display = toDisplayState(stateRef.current);
			setResult({
				parts: display.parts,
				streamingTail: display.streamingTail,
				lastStatus: display.lastStatus,
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
