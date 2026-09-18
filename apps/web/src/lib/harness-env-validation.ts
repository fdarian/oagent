export type HarnessEnvEntry = {
	key: string;
	value: string;
};

const environmentKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateEnvironmentKey(value: string): string | undefined {
	if (value.trim() === '') return 'Environment variable name is required';
	if (!environmentKeyPattern.test(value)) {
		return 'Use letters, numbers, and underscores; the first character cannot be a number';
	}
	return undefined;
}

export function validateDuplicateEnvironmentKeys(
	entries: ReadonlyArray<HarnessEnvEntry>,
): string | undefined {
	const keys = new Set<string>();
	for (const entry of entries) {
		if (keys.has(entry.key)) return 'Environment variable names must be unique';
		keys.add(entry.key);
	}
	return undefined;
}

export function validateEnvironmentKeyAtIndex(
	value: string,
	entries: ReadonlyArray<HarnessEnvEntry>,
	index: number,
): string | undefined {
	const keyError = validateEnvironmentKey(value);
	if (keyError !== undefined) return keyError;

	for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
		if (entryIndex !== index && entries[entryIndex]?.key === value) {
			return 'Environment variable names must be unique';
		}
	}
	return undefined;
}
