import { useEffect, useRef, useState } from 'react';
import {
	applyEvent,
	type ChildTimeline,
	createInitialState,
	finalizeState,
	type ReduceState,
	type TimelinePart,
	toDisplayState,
} from './event-adapter.ts';
import { getEngineEndpointURL } from './orpc.ts';

export type JobEventsState = {
	jobId?: string;
	parts: TimelinePart[];
	streamingTail: TimelinePart | null;
	children: Map<string, ChildTimeline>;
	lastStatus?: string;
	terminal: boolean;
	isLoading: boolean;
};

const SSE_RETRY_DELAY_MS = 1000;

export function useJobEvents(
	jobId: string | undefined,
	onConnectionError?: (jobId: string) => void,
): JobEventsState {
	const [result, setResult] = useState<JobEventsState>({
		parts: [],
		streamingTail: null,
		children: new Map(),
		terminal: false,
		isLoading: false,
	});
	const stateRef = useRef<ReduceState>(createInitialState());

	useEffect(() => {
		if (jobId === undefined) {
			stateRef.current = createInitialState();
			setResult({
				jobId,
				parts: [],
				streamingTail: null,
				children: new Map(),
				terminal: false,
				isLoading: false,
			});
			return;
		}

		let activeSource: EventSource | undefined;
		let retryTimer: number | undefined;
		let stopped = false;

		const reset = () => {
			stateRef.current = createInitialState();
			setResult({
				jobId,
				parts: [],
				streamingTail: null,
				children: new Map(),
				terminal: false,
				isLoading: true,
			});
		};

		const connect = () => {
			if (stopped) return;
			reset();
			const source = new EventSource(
				getEngineEndpointURL(`/jobs/${encodeURIComponent(jobId)}/events`),
			);
			activeSource = source;

			source.onmessage = (event) => {
				if (stopped || activeSource !== source) return;
				const data = JSON.parse(event.data);
				if (data === '__terminal__') {
					activeSource = undefined;
					source.close();
					const final = finalizeState(stateRef.current);
					setResult({
						jobId,
						parts: final.parts,
						streamingTail: null,
						children: final.children,
						lastStatus: final.lastStatus,
						terminal: true,
						isLoading: false,
					});
					return;
				}
				stateRef.current = applyEvent(stateRef.current, data, Date.now());
				const display = toDisplayState(stateRef.current);
				setResult({
					jobId,
					parts: display.parts,
					streamingTail: display.streamingTail,
					children: display.children,
					lastStatus: display.lastStatus,
					terminal: false,
					isLoading: false,
				});
			};

			source.onerror = () => {
				if (stopped || activeSource !== source) return;
				activeSource = undefined;
				source.close();
				setResult((previous) => {
					if (previous.jobId !== jobId) return previous;
					return { ...previous, isLoading: false };
				});
				if (onConnectionError !== undefined) {
					onConnectionError(jobId);
				}
				retryTimer = window.setTimeout(connect, SSE_RETRY_DELAY_MS);
			};
		};

		connect();

		return () => {
			stopped = true;
			if (retryTimer !== undefined) {
				window.clearTimeout(retryTimer);
			}
			activeSource?.close();
		};
	}, [jobId, onConnectionError]);

	return result;
}
