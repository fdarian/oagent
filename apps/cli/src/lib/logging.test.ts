import { describe, expect, test } from 'bun:test';
import { filterExpiredLogFiles, getDailyLogFileName } from './logging.ts';

describe('oagent log file naming', () => {
	test('uses the local calendar date', () => {
		const date = new Date(2026, 8, 13, 23, 59, 58);

		expect(getDailyLogFileName(date)).toBe('oagent-2026-09-13.jsonl');
	});
});

describe('oagent log retention', () => {
	test('filters only dated files older than 30 days', () => {
		const now = new Date(2026, 8, 13, 12);
		const fileNames = [
			'oagent-2026-08-13.jsonl',
			'oagent-2026-08-14.jsonl',
			'oagent-2026-09-13.jsonl',
			'oagent-2026-09-14.jsonl',
			'oagent-2026-99-99.jsonl',
			'other-2026-08-01.jsonl',
		];

		expect(filterExpiredLogFiles(fileNames, now)).toEqual([
			'oagent-2026-08-13.jsonl',
		]);
	});
});
