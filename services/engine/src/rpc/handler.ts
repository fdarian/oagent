import { ORPCError, onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { Effect } from 'effect';
import { AgentNotMappedForBackend, AgentTypeNotFound } from '../agents.ts';
import { HarnessModelError } from '../harness.ts';
import { HarnessesError } from '../harnesses.ts';
import { JobNotFound, JobSteerError } from '../jobs.ts';
import { SideChatError, SideChatNotFound } from '../side-chats.ts';
import { WorktreeError } from '../worktree.ts';
import { type EngineServices, router } from './router.ts';

function toProcedureError(error: unknown) {
	if (error instanceof JobNotFound) {
		return new ORPCError('NOT_FOUND', {
			message: error.message,
			cause: error,
		});
	}
	if (error instanceof JobSteerError) {
		return new ORPCError('BAD_REQUEST', {
			message: error.message,
			cause: error,
		});
	}
	if (error instanceof WorktreeError) {
		return new ORPCError('BAD_REQUEST', {
			message: error.message,
			cause: error,
		});
	}
	if (error instanceof SideChatNotFound) {
		return new ORPCError('NOT_FOUND', {
			message: error.message,
			cause: error,
		});
	}
	if (error instanceof SideChatError) {
		return new ORPCError('BAD_REQUEST', {
			message: error.message,
			cause: error,
			data: { code: error.code },
		});
	}
	if (
		error instanceof HarnessesError ||
		error instanceof HarnessModelError ||
		error instanceof AgentTypeNotFound ||
		error instanceof AgentNotMappedForBackend
	) {
		return new ORPCError('INTERNAL_SERVER_ERROR', {
			message: error.message,
			cause: error,
		});
	}
	return undefined;
}

export const createEngineHandler = Effect.gen(function* () {
	const services = yield* Effect.context<EngineServices>();
	const handler = new RPCHandler(router, {
		interceptors: [
			onError(async (error, options) => {
				await Effect.runPromise(
					Effect.logError(
						`RPC request failed: ${options.request.url}`,
						error,
					).pipe(Effect.provide(services)),
				);
				const procedureError = toProcedureError(error);
				if (procedureError !== undefined) throw procedureError;
			}),
		],
	});
	return handler;
});
