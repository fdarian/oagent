import { afterEach, describe, expect, test } from 'bun:test';
import {
	getClaudeBinary,
	getClaudeConfigOptions,
	resolveClaudeBinary,
} from './claude.ts';

const previousClaudeBinary = process.env.OAGENT_CLAUDE_BIN;

afterEach(() => {
	if (previousClaudeBinary === undefined) {
		delete process.env.OAGENT_CLAUDE_BIN;
		return;
	}
	process.env.OAGENT_CLAUDE_BIN = previousClaudeBinary;
});

describe('Claude ACP backend', () => {
	test('resolves the configured Claude ACP binary', () => {
		process.env.OAGENT_CLAUDE_BIN = 'sh';
		const shBinary = Bun.which('sh');

		expect(getClaudeBinary()).toBe('sh');
		expect(resolveClaudeBinary()).toBe(
			shBinary === null ? undefined : shBinary,
		);
	});

	test('translates reasoning effort into Claude config options', () => {
		expect(getClaudeConfigOptions('claude-sonnet', 'high')).toEqual([
			{ configId: 'model', value: 'claude-sonnet' },
			{ configId: 'effort', value: 'high' },
		]);
		expect(getClaudeConfigOptions('claude-sonnet', undefined)).toEqual([
			{ configId: 'model', value: 'claude-sonnet' },
		]);
	});
});
