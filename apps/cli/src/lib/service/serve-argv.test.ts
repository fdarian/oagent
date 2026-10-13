import { expect, test } from 'bun:test';
import {
	describeDaemonMismatch,
	findServeIndex,
	formatDaemonMismatchMessage,
	parseServeArgv,
	tokenizeCommand,
} from './serve-argv.ts';

const onDemand = tokenizeCommand(
	'/Users/me/.local/bin/oagent serve --port 17777 --idle-exit 10m --log-file /tmp/oagent.jsonl',
);

test('parses binary, port, portless and idle-exit from a daemon command', () => {
	expect(parseServeArgv(onDemand)).toEqual({
		binary: ['/Users/me/.local/bin/oagent'],
		port: 17777,
		portless: false,
		idleExit: true,
	});
	expect(
		parseServeArgv(
			tokenizeCommand(
				'/usr/bin/bun /repo/apps/cli/src/index.ts serve --port=18000 --portless --log-level info',
			),
		),
	).toEqual({
		binary: ['/usr/bin/bun', '/repo/apps/cli/src/index.ts'],
		port: 18000,
		portless: true,
		idleExit: false,
	});
});

test('non-serve commands are not parsed', () => {
	expect(findServeIndex(tokenizeCommand('/bin/oagent session list'))).toBe(
		undefined,
	);
	expect(parseServeArgv(['vim', 'serve'])).toBeUndefined();
});

test('matching requests produce no mismatch', () => {
	const running = parseServeArgv(onDemand);
	if (running === undefined) throw new Error('expected a parsed daemon');
	expect(
		describeDaemonMismatch(running, {
			binary: ['/Users/me/.local/bin/oagent'],
			port: 17777,
			portless: false,
		}),
	).toEqual([]);
});

test('every differing setting is reported with running and requested values', () => {
	const running = parseServeArgv(onDemand);
	if (running === undefined) throw new Error('expected a parsed daemon');
	expect(
		describeDaemonMismatch(running, {
			binary: ['/usr/bin/bun', '/repo/index.ts'],
			port: 18000,
			portless: true,
		}),
	).toEqual([
		'port: running 17777, requested 18000',
		'portless: running no, requested yes',
		'binary: running /Users/me/.local/bin/oagent, requested /usr/bin/bun /repo/index.ts',
	]);
});

test('a daemon without --port never matches a requested port', () => {
	const running = parseServeArgv(tokenizeCommand('/bin/oagent serve'));
	if (running === undefined) throw new Error('expected a parsed daemon');
	expect(
		describeDaemonMismatch(running, {
			binary: ['/bin/oagent'],
			port: 17777,
			portless: false,
		}),
	).toEqual(['port: running unknown, requested 17777']);
});

test('the mismatch message is one line that mentions each difference once', () => {
	const message = formatDaemonMismatchMessage(4242, [
		'port: running 1, requested 2',
		'binary: running /a, requested /b',
	]);
	expect(message).not.toContain('\n');
	expect(message.split('binary: running').length).toBe(2);
	expect(message.split('port: running').length).toBe(2);
	expect(message).toContain('pid 4242');
	expect(message).toContain('oagent service stop');
});
