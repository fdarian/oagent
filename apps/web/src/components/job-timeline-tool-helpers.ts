export function readToolStringProp(
	value: unknown,
	key: string,
): string | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const prop = (value as Record<string, unknown>)[key];
	return typeof prop === 'string' ? prop : undefined;
}
