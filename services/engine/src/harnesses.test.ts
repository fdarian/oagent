import { describe, expect, test } from 'bun:test';
import { parseLoginPrompt } from './codex.ts';

const capturedLoginOutput = [
	'',
	'Welcome to Codex [v\u001b[90m0.154.0\u001b[0m]',
	"\u001b[90mOpenAI's command-line coding agent\u001b[0m",
	'',
	'Follow these steps to sign in with ChatGPT using device code authorization:',
	'',
	'1. Open this link in your browser and sign in',
	'   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m',
	'',
	'2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m',
	'   \u001b[94mAWXP-X8EU4\u001b[0m',
	'',
	'\u001b[90mContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\u001b[0m',
	'',
	'',
].join('\n');

describe('Codex login prompt parsing', () => {
	test('parses the captured device-code output', () => {
		expect(parseLoginPrompt(capturedLoginOutput)).toEqual({
			verificationUrl: 'https://auth.openai.com/codex/device',
			userCode: 'AWXP-X8EU4',
		});
	});

	test('accepts URL suffixes and unequal code segment lengths', () => {
		expect(
			parseLoginPrompt(
				'https://auth.openai.com/codex/device?source=oagent\nABC-12345',
			),
		).toEqual({
			verificationUrl: 'https://auth.openai.com/codex/device?source=oagent',
			userCode: 'ABC-12345',
		});
	});
});
