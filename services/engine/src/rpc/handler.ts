import { ORPCError, onError } from '@orpc/server';
import { FetchHandler } from '@orpc/server/fetch';
import { StandardRPCHandler } from '@orpc/server/standard';
import { Effect } from 'effect';
import { HarnessesError } from '../harnesses.ts';
import { ModelCatalogError } from '../model-catalog.ts';
import { program } from './router.ts';

function toProcedureError(
	error: unknown,
): ORPCError<'INTERNAL_SERVER_ERROR', unknown> | undefined {
	if (error instanceof HarnessesError || error instanceof ModelCatalogError) {
		return new ORPCError('INTERNAL_SERVER_ERROR', {
			message: error.message,
			cause: error,
		});
	}
	return undefined;
}

export const createEngineHandler = Effect.gen(function* () {
	const router = yield* program;
	const services = yield* Effect.context<never>();
	const standardHandler = new StandardRPCHandler(router, {
		interceptors: [
			onError(async (error, options) => {
				await Effect.runPromise(
					Effect.logError(
						`RPC request failed: ${options.request.url.pathname}`,
						error,
					).pipe(Effect.provide(services)),
				);
				const procedureError = toProcedureError(error);
				if (procedureError !== undefined) throw procedureError;
			}),
		],
	});
	const fetchHandler = new FetchHandler(standardHandler);
	return fetchHandler;
});
