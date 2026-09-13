import { describe, expect, test } from 'bun:test';
import { filterRetainedLogLines } from './logging.ts';

describe('oagent log retention', () => {
	test('keeps recent records and reports dropped unparseable lines', () => {
		const now = new Date('2026-09-13T12:00:00.000Z');
		const recentLine =
			'{"timestamp":"2026-08-14T12:00:00.001Z","message":"recent"}';
		const oldLine = '{"timestamp":"2026-08-14T11:59:59.999Z","message":"old"}';
		const futureLine =
			'{"timestamp":"2026-09-14T12:00:00.000Z","message":"future"}';
		const result = filterRetainedLogLines(
			[recentLine, oldLine, futureLine, 'not json', '{"message":"missing"}'],
			now,
		);

		expect(result.lines).toEqual([recentLine, futureLine]);
		expect(result.unparseableCount).toBe(2);
	});
});
