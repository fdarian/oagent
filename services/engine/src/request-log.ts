export function requestLogFields(input: {
	jobId?: string;
	sessionId?: string;
}): string {
	const fields: string[] = [];
	if (input.jobId !== undefined) fields.push(`jobId=${input.jobId}`);
	if (input.sessionId !== undefined)
		fields.push(`sessionId=${input.sessionId}`);
	return fields.join(' ');
}
