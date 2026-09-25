export type TurnWaitResult =
	| { status: 'running' }
	| { status: 'done'; text: string }
	| { status: 'error'; message: string }
	| { status: 'cancelled' };

export function formatTurnResult(input: {
	sessionId: string;
	jobId: string;
	result: TurnWaitResult;
	worktreePath?: string;
	worktreeBranch?: string;
	steered?: boolean;
}): string {
	const lines = [
		`Session ID: ${input.sessionId}`,
		`Job ID: ${input.jobId}`,
		`Status: ${input.result.status}`,
	];
	if (input.worktreePath !== undefined) {
		const branch =
			input.worktreeBranch === undefined ? '' : ` (${input.worktreeBranch})`;
		lines.push(`Worktree: ${input.worktreePath}${branch}`);
	}
	if (input.steered === true) {
		lines.push('Message queued for delivery at the next step boundary.');
		return lines.join('\n');
	}
	if (input.result.status === 'running') {
		lines.push(`Call \`read\` with session ID \`${input.sessionId}\`.`);
		return lines.join('\n');
	}
	if (input.result.status === 'done') {
		return `${lines.join('\n')}\n---\n${input.result.text}`;
	}
	if (input.result.status === 'error') {
		return `${lines.join('\n')}\n---\n${input.result.message}`;
	}
	return `${lines.join('\n')}\n---\nThe turn was cancelled.`;
}

export function formatToolError(message: string): string {
	return `Status: error\n---\n${message}`;
}

export function formatSessionError(sessionId: string, message: string): string {
	return `Session ID: ${sessionId}\nStatus: error\n---\n${message}`;
}

export function formatCancellation(input: {
	sessionId: string;
	status: 'cancelled' | 'idle';
}): string {
	if (input.status === 'cancelled') {
		return `Session ID: ${input.sessionId}\nStatus: cancelled`;
	}
	return `Session ID: ${input.sessionId}\nStatus: idle\nNo running turn to cancel.`;
}
