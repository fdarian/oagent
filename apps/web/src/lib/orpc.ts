import type { EngineRouter } from '@oagent/engine';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import { createEngineEndpointURL } from './engine-url.ts';

function getConfiguredEngineURL(): string {
	const engineOverride = new URLSearchParams(location.search).get('engine');
	if (engineOverride === null) return '/rpc';
	return engineOverride;
}

const configuredEngineURL = getConfiguredEngineURL();
const rpcURL = createEngineEndpointURL(
	configuredEngineURL,
	'/rpc',
	location.origin,
);
const rpcPath = `${rpcURL.pathname}${rpcURL.search}` as `/${string}`;
const link = new RPCLink({
	origin: rpcURL.origin,
	url: rpcPath,
});
export const orpc: RouterClient<EngineRouter> = createORPCClient(link);

export function getEngineEndpointURL(endpoint: string): string {
	return createEngineEndpointURL(
		configuredEngineURL,
		endpoint,
		location.origin,
	).toString();
}
