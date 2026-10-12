import { describe, expect, test } from 'bun:test';
import { deriveTitle, resolvePrompt } from './shared.ts';

describe('deriveTitle', () => {
	test('uses the first non-empty line, trimmed', () => {
		expect(deriveTitle('\n\n  Fix the login bug  \nmore detail')).toBe(
			'Fix the login bug',
		);
	});

	test('cuts long lines to 60 characters', () => {
		const title = deriveTitle('x'.repeat(100));
		expect(title).toBe('x'.repeat(60));
	});

	test('does not leave trailing whitespace after cutting', () => {
		const title = deriveTitle(`${'x'.repeat(59)} tail`);
		expect(title).toBe('x'.repeat(59));
	});

	test('rejects a prompt with no content', () => {
		expect(() => deriveTitle(' \n\t\n')).toThrow();
	});
});

describe('resolvePrompt', () => {
	const unreadable = () => Promise.reject(new Error('stdin must not be read'));

	test('prefers the positional prompt over stdin', async () => {
		await expect(
			resolvePrompt({
				positional: 'from arg',
				stdinIsTTY: false,
				readStdin: unreadable,
			}),
		).resolves.toBe('from arg');
	});

	test('reads a multi-line prompt from piped stdin', async () => {
		await expect(
			resolvePrompt({
				positional: undefined,
				stdinIsTTY: false,
				readStdin: async () => 'line one\nline two\n',
			}),
		).resolves.toBe('line one\nline two\n');
	});

	test('fails when there is no argument and stdin is a terminal', async () => {
		await expect(
			resolvePrompt({
				positional: undefined,
				stdinIsTTY: true,
				readStdin: unreadable,
			}),
		).rejects.toThrow('No prompt provided');
	});

	test('fails on an empty prompt', async () => {
		await expect(
			resolvePrompt({
				positional: undefined,
				stdinIsTTY: false,
				readStdin: async () => ' \n',
			}),
		).rejects.toThrow('empty');
		await expect(
			resolvePrompt({
				positional: '',
				stdinIsTTY: true,
				readStdin: unreadable,
			}),
		).rejects.toThrow('empty');
	});
});
