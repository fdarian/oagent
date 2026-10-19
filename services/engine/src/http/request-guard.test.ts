import { describe, expect, test } from 'bun:test';
import { rejectUntrustedRequest } from './request-guard.ts';

function guard(
	pathname: string,
	headers: Record<string, string>,
): Response | undefined {
	return rejectUntrustedRequest(
		new Request(`http://127.0.0.1:17777${pathname}`, { headers }),
		pathname,
	);
}

describe('Host check', () => {
	test.each([
		'127.0.0.1:17777',
		'localhost:17777',
		'LOCALHOST',
		'[::1]:17777',
		'oagent.localhost',
		'oagent.localhost:1355',
	])('allows %s', (host) => {
		expect(guard('/rpc/sessions', { host })).toBeUndefined();
		expect(guard('/', { host })).toBeUndefined();
	});

	test('rejects a DNS rebinding host on API and SPA routes', () => {
		for (const pathname of ['/rpc/sessions', '/mcp', '/jobs/abc/wait', '/']) {
			const response = guard(pathname, { host: 'evil.com:17777' });
			expect(response?.status).toBe(403);
			expect(response?.headers.get('content-type')).toContain('text/plain');
		}
	});

	test('rejects a missing Host header', () => {
		const request = new Request('http://127.0.0.1:17777/rpc');
		request.headers.delete('host');
		expect(rejectUntrustedRequest(request, '/rpc')?.status).toBe(403);
	});

	test('rejects hosts that only embed a trusted name', () => {
		expect(guard('/', { host: 'localhost.evil.com' })?.status).toBe(403);
		expect(guard('/', { host: 'evil.com@127.0.0.1' })?.status).toBe(403);
	});
});

describe('Origin check', () => {
	const host = '127.0.0.1:17777';

	test('rejects a foreign Origin on API routes', () => {
		expect(
			guard('/rpc/sessions', { host, origin: 'http://evil.com' })?.status,
		).toBe(403);
		expect(guard('/mcp', { host, origin: 'http://evil.com' })?.status).toBe(
			403,
		);
	});

	test('allows local Origins on any port and scheme', () => {
		for (const origin of [
			'http://localhost:5173',
			'http://127.0.0.1:17777',
			'https://oagent.localhost',
		]) {
			expect(guard('/rpc/sessions', { host, origin })).toBeUndefined();
		}
	});

	test('rejects Origin null and unparseable Origins', () => {
		expect(guard('/rpc', { host, origin: 'null' })?.status).toBe(403);
		expect(guard('/rpc', { host, origin: 'not a url' })?.status).toBe(403);
	});

	test('rejects a cross-site fetch without Origin on API routes only', () => {
		const headers = { host, 'sec-fetch-site': 'cross-site' };
		expect(guard('/rpc/sessions', headers)?.status).toBe(403);
		expect(guard('/jobs/abc/events', headers)?.status).toBe(403);
		expect(guard('/', headers)).toBeUndefined();
	});

	test('allows same-origin and header-less clients', () => {
		expect(
			guard('/rpc/sessions', { host, 'sec-fetch-site': 'same-origin' }),
		).toBeUndefined();
		expect(guard('/rpc/sessions', { host })).toBeUndefined();
		expect(guard('/mcp', { host })).toBeUndefined();
	});
});
