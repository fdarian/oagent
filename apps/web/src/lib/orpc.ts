import type { EngineRouter } from '@oagent/engine';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import {
	createEngineEndpointURL,
	resolveConfiguredEngineURL,
} from './engine-url.ts';

const configuredEngineURL = resolveConfiguredEngineURL(
	location.search,
	sessionStorage,
);
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
export const client: RouterClient<EngineRouter> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

export function getEngineEndpointURL(endpoint: string): string {
	return createEngineEndpointURL(
		configuredEngineURL,
		endpoint,
		location.origin,
	).toString();
}
