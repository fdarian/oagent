import { useEffect, useState } from 'react';
import {
	applyEvent,
	type ChildTimeline,
	createInitialState,
	finalizeState,
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

export function subscribeJobEvents(
	jobId: string,
	onUpdate: (state: JobEventsState) => void,
	onConnectionError?: (jobId: string) => void,
): () => void {
	let state = createInitialState();
	let activeSource: EventSource | undefined;
	let retryTimer: number | undefined;
	let stopped = false;

	const connect = () => {
		if (stopped) return;
		state = createInitialState();
		onUpdate({
			jobId,
			parts: [],
			streamingTail: null,
			children: new Map(),
			terminal: false,
			isLoading: true,
		});
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
				const final = finalizeState(state);
				onUpdate({
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
			state = applyEvent(state, data, Date.now());
			const display = toDisplayState(state);
			onUpdate({
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
			if (onConnectionError !== undefined) onConnectionError(jobId);
			retryTimer = window.setTimeout(connect, SSE_RETRY_DELAY_MS);
		};
	};

	connect();
	return () => {
		stopped = true;
		if (retryTimer !== undefined) window.clearTimeout(retryTimer);
		activeSource?.close();
	};
}

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
	useEffect(() => {
		if (jobId === undefined) {
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

		return subscribeJobEvents(jobId, setResult, (id) => {
			setResult((previous) =>
				previous.jobId === id ? { ...previous, isLoading: false } : previous,
			);
			onConnectionError?.(id);
		});
	}, [jobId, onConnectionError]);

	return result;
}
