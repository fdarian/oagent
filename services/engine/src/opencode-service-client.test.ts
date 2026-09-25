import { expect, test } from 'bun:test';
import { isOpenCodeServiceStopped } from './opencode-service-client.ts';

test('recognizes stopped service status before URL parsing', () => {
	expect(isOpenCodeServiceStopped('stopped\n')).toBe(true);
	expect(isOpenCodeServiceStopped('http://127.0.0.1:49374\n')).toBe(false);
});
