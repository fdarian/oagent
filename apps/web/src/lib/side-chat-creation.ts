import type { MutationFilters } from '@tanstack/react-query';
import { orpc } from './orpc.ts';

export type SideChatCreation = {
	sourceJobId: string;
	drawerInstance: number;
};

export const sideChatCreateMutationKey = orpc.sideChats.create.mutationKey();

function isSideChatCreation(value: unknown): value is SideChatCreation {
	if (typeof value !== 'object' || value === null) return false;
	return (
		'sourceJobId' in value &&
		typeof value.sourceJobId === 'string' &&
		'drawerInstance' in value &&
		typeof value.drawerInstance === 'number'
	);
}

export function isSideChatCreationForJob(input: {
	creation: unknown;
	jobId: string;
}): boolean {
	return (
		isSideChatCreation(input.creation) &&
		input.creation.sourceJobId === input.jobId
	);
}

export function sideChatCreateMutationFilter(jobId: string): MutationFilters {
	return {
		mutationKey: sideChatCreateMutationKey,
		predicate: (mutation) =>
			isSideChatCreationForJob({
				creation: mutation.state.variables,
				jobId,
			}),
	};
}

export function isCurrentSideChatCreation(input: {
	creation: SideChatCreation;
	currentJobId: string;
	currentDrawerInstance: number;
}): boolean {
	return (
		input.creation.sourceJobId === input.currentJobId &&
		input.creation.drawerInstance === input.currentDrawerInstance
	);
}
