export const PORTLESS_ALIAS = 'oagent';

const TRUSTED_HOSTNAMES = new Set([
	'127.0.0.1',
	'localhost',
	'[::1]',
	`${PORTLESS_ALIAS}.localhost`,
]);

const INVALID_HOST_CHARS = /[@/?#\\\s]/;

function isApiPath(pathname: string) {
	return (
		pathname === '/mcp' ||
		pathname === '/rpc' ||
		pathname.startsWith('/rpc/') ||
		pathname === '/jobs' ||
		pathname.startsWith('/jobs/')
	);
}

function isTrustedHostname(hostname: string) {
	return TRUSTED_HOSTNAMES.has(hostname.toLowerCase());
}

function hasTrustedHost(host: string | null) {
	if (host === null || INVALID_HOST_CHARS.test(host)) return false;
	const candidate = `http://${host}`;
	if (!URL.canParse(candidate)) return false;
	return isTrustedHostname(new URL(candidate).hostname);
}

function hasTrustedOrigin(origin: string) {
	if (!URL.canParse(origin)) return false;
	const url = new URL(origin);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
	return isTrustedHostname(url.hostname);
}

function forbidden(reason: string) {
	return new Response(`Forbidden: ${reason}`, {
		status: 403,
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
}

/**
 * Defends the local server against browser-driven attacks. The Host check
 * (every route) blocks DNS rebinding; the Origin / Sec-Fetch-Site check (API
 * routes only) blocks cross-site requests. Non-browser clients send neither
 * header and pass. SPA paths skip the second check so other sites can still
 * link to the UI.
 */
export function rejectUntrustedRequest(
	request: Request,
	pathname: string,
): Response | undefined {
	if (!hasTrustedHost(request.headers.get('host')))
		return forbidden('untrusted Host header');
	if (!isApiPath(pathname)) return undefined;

	const origin = request.headers.get('origin');
	if (origin !== null) {
		return hasTrustedOrigin(origin) ? undefined : forbidden('untrusted Origin');
	}
	if (request.headers.get('sec-fetch-site') === 'cross-site')
		return forbidden('cross-site request');
	return undefined;
}
