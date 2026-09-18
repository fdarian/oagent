import { describe, expect, test } from 'bun:test';
import {
	validateDuplicateEnvironmentKeys,
	validateEnvironmentKeyAtIndex,
} from './harness-env-validation';

describe('harness environment validation', () => {
	test('rejects duplicate names at the array and field level', () => {
		const entries = [
			{ key: 'OPENCODE_DISABLE_CLAUDE_CODE', value: '1' },
			{ key: 'OPENCODE_DISABLE_CLAUDE_CODE', value: '0' },
		];

		expect(validateDuplicateEnvironmentKeys(entries)).toBe(
			'Environment variable names must be unique',
		);
		expect(validateEnvironmentKeyAtIndex(entries[1].key, entries, 1)).toBe(
			'Environment variable names must be unique',
		);
	});

	test('keeps format validation on the individual key field', () => {
		expect(
			validateEnvironmentKeyAtIndex('1BAD', [{ key: '', value: '' }], 0),
		).toBe(
			'Use letters, numbers, and underscores; the first character cannot be a number',
		);
	});
});
