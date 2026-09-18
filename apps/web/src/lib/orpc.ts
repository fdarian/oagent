import type { EngineRouter } from '@oagent/engine';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';

const baseURL = import.meta.env.DEV
	? '/rpc'
	: (new URLSearchParams(location.search).get('engine') ?? '/rpc');

const rpcURL = new URL(baseURL, location.origin);
const rpcPath = `${rpcURL.pathname}${rpcURL.search}` as `/${string}`;
const link = new RPCLink({
	origin: rpcURL.origin,
	url: rpcPath,
});
export const orpc: RouterClient<EngineRouter> = createORPCClient(link);
