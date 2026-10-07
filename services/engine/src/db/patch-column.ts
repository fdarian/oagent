/**
 * ACP patch fields distinguish omitted (unchanged) from `null` (cleared) from a
 * value. Stored as: SQL NULL = omitted, JSON `null` = cleared, other JSON = value.
 */
export function toPatchColumn(value: unknown): string | null {
	return value === undefined ? null : JSON.stringify(value);
}

export function fromPatchColumn<T>(
	column: string | null,
): T | null | undefined {
	return column === null ? undefined : (JSON.parse(column) as T | null);
}
