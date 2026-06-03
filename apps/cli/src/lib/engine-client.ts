import type { EngineRouter } from '@oagent/engine';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';

export type EngineClient = RouterClient<EngineRouter>;

export const defaultEngineUrl = `http://localhost:${process.env.OPENCODE_MCP_PORT ?? '17777'}`;

export function createEngineClient(engineUrl: string): EngineClient {
	const link = new RPCLink({ url: new URL('/rpc', engineUrl) });
	return createORPCClient(link);
}
