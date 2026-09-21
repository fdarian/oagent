function engineBasePath(pathname: string): string {
	const withoutTrailingSlash = pathname.endsWith('/')
		? pathname.slice(0, -1)
		: pathname;
	if (withoutTrailingSlash.endsWith('/rpc')) {
		return withoutTrailingSlash.slice(0, -'/rpc'.length);
	}
	return withoutTrailingSlash;
}

export function createEngineEndpointURL(
	configuredEngineURL: string,
	endpoint: string,
	locationOrigin: string,
): URL {
	const url = new URL(configuredEngineURL, locationOrigin);
	const endpointPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
	url.pathname = `${engineBasePath(url.pathname)}${endpointPath}`;
	url.hash = '';
	return url;
}
