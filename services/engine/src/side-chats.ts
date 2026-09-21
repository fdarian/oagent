/// <reference types="bun" />

import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { randomUUIDv7 } from 'bun';
import { and, eq, isNull } from 'drizzle-orm';
import { Context, Effect, Layer, Ref, Schema } from 'effect';
import { AcpForkNotSupportedError } from './acp-agent.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { JobNotFound, JobStartError, Jobs } from './jobs.ts';

export const SIDE_CHAT_FIRST_PROMPT_REMINDER =
	"<system-reminder>You are in a forked side chat. This conversation is separate from the main session. Do not continue the main session's task unless the user explicitly asks you to do so here. Messages in this side chat are not sent back to the main session, though both sessions share the same working directory and filesystem.</system-reminder>";

export class SideChatNotFound extends Schema.TaggedError<SideChatNotFound>()(
	'SideChatNotFound',
	{
		sideChatId: Schema.String,
	},
) {
	override get message() {
		return `Side chat not found: ${this.sideChatId}`;
	}
}

export class SideChatError extends Schema.TaggedError<SideChatError>()(
	'SideChatError',
	{
		code: Schema.Literals([
			'UNSUPPORTED_HARNESS',
			'SESSION_NOT_READY',
			'FORK_NOT_SUPPORTED',
			'FORK_FAILED',
			'TURN_IN_PROGRESS',
			'SOURCE_NOT_READY',
		]),
		message: Schema.String,
	},
) {}

type SideChatRow = typeof schema.sideChats.$inferSelect;
type JobRow = typeof schema.jobs.$inferSelect;

function firstSideChatPrompt(prompt: string): string {
	return `${prompt}\n\n${SIDE_CHAT_FIRST_PROMPT_REMINDER}`;
}

function toTimestamp(value: Date | null): number | undefined {
	if (value === null) return undefined;
	return value.getTime();
}

export class SideChats extends Context.Service<SideChats>()(
	'oagent/SideChats',
	{
		make: Effect.gen(function* () {
			const dbService = yield* Db;
			const db = dbService.db;
			const jobs = yield* Jobs;
			const harnessRegistry = yield* HarnessRegistry;

			const findSourceJob = (
				sourceJobId: string,
			): Effect.Effect<JobRow, JobNotFound, never> =>
				Effect.sync(() =>
					db
						.select()
						.from(schema.jobs)
						.where(eq(schema.jobs.uuid, sourceJobId))
						.limit(1)
						.get(),
				).pipe(
					Effect.flatMap((sourceJob) =>
						sourceJob === undefined
							? new JobNotFound({ jobId: sourceJobId })
							: Effect.succeed(sourceJob),
					),
				);

			const findSideChat = (
				sideChatId: string,
			): Effect.Effect<SideChatRow, SideChatNotFound, never> =>
				Effect.sync(() =>
					db
						.select()
						.from(schema.sideChats)
						.where(eq(schema.sideChats.uuid, sideChatId))
						.limit(1)
						.get(),
				).pipe(
					Effect.flatMap((sideChat) =>
						sideChat === undefined
							? new SideChatNotFound({ sideChatId })
							: Effect.succeed(sideChat),
					),
				);

			const validateSource = (
				sourceJob: JobRow,
			): Effect.Effect<JobRow, SideChatError, never> => {
				if (sourceJob.backend !== 'opencode') {
					return new SideChatError({
						code: 'UNSUPPORTED_HARNESS',
						message: `Side chats are only supported for OpenCode jobs. This job uses the ${sourceJob.backend} harness.`,
					});
				}
				if (sourceJob.side_chat_id !== null) {
					return new SideChatError({
						code: 'SOURCE_NOT_READY',
						message:
							'A side-chat turn cannot be used as the source of another side chat.',
					});
				}
				return Effect.succeed(sourceJob);
			};

			const readTurnEvents = (jobId: string) => {
				const events: Array<{ event: SessionUpdate; createdAt: number }> = [];
				let cursor = 0;
				while (true) {
					const page = jobs.readEventsPage(jobId, cursor, 100);
					for (const item of page.events) {
						events.push({ event: item.event, createdAt: item.createdAt });
					}
					if (page.nextCursor === null) return events;
					cursor = page.nextCursor;
				}
			};

			const toSideChat = (sideChat: SideChatRow) => {
				const turns = db
					.select()
					.from(schema.jobs)
					.where(eq(schema.jobs.side_chat_id, sideChat.id))
					.orderBy(schema.jobs.created_at, schema.jobs.id)
					.all()
					.map((turn) => {
						const terminatedAt = toTimestamp(turn.terminated_at);
						return {
							id: turn.uuid,
							status: turn.status,
							createdAt: turn.created_at.getTime(),
							...(terminatedAt === undefined ? {} : { terminatedAt }),
							prompt: turn.prompt,
							...(turn.error_message === null
								? {}
								: { errorMessage: turn.error_message }),
							events: readTurnEvents(turn.uuid),
						};
					});

				return {
					id: sideChat.uuid,
					createdAt: sideChat.created_at.getTime(),
					turns,
				};
			};

			const list = (sourceJobId: string) =>
				Effect.gen(function* () {
					const sourceJob = yield* findSourceJob(sourceJobId);
					const sideChats = db
						.select()
						.from(schema.sideChats)
						.where(eq(schema.sideChats.source_job_id, sourceJob.id))
						.orderBy(schema.sideChats.created_at, schema.sideChats.id)
						.all();
					return sideChats.map(toSideChat);
				});

			const create = (sourceJobId: string) =>
				Effect.gen(function* () {
					const sourceJob = yield* findSourceJob(sourceJobId);
					yield* validateSource(sourceJob);
					const sideChat = db
						.insert(schema.sideChats)
						.values({
							uuid: randomUUIDv7(),
							source_job_id: sourceJob.id,
						})
						.returning()
						.get();
					if (sideChat === undefined) {
						return yield* Effect.die(new Error('Failed to create side chat'));
					}
					return toSideChat(sideChat);
				});

			const send = (input: { sideChatId: string; prompt: string }) =>
				Effect.gen(function* () {
					const sideChat = yield* findSideChat(input.sideChatId);
					const sourceJob = db
						.select()
						.from(schema.jobs)
						.where(eq(schema.jobs.id, sideChat.source_job_id))
						.limit(1)
						.get();
					if (sourceJob === undefined) {
						return yield* new SideChatError({
							code: 'SOURCE_NOT_READY',
							message:
								'The source job for this side chat is no longer available.',
						});
					}
					yield* validateSource(sourceJob);

					const sourceSessionId = sourceJob.session_id;
					if (sourceSessionId === null) {
						return yield* new SideChatError({
							code: 'SESSION_NOT_READY',
							message:
								'The source OpenCode session is not ready yet. Wait for the job to create its session, then try again.',
						});
					}
					const sourceModel = sourceJob.model;
					if (sourceModel === null) {
						return yield* new SideChatError({
							code: 'SOURCE_NOT_READY',
							message:
								'The source job does not have a recorded model, so a side-chat turn cannot be started.',
						});
					}

					const acquireReservation = jobs
						.reserve({
							prompt: input.prompt,
							model: `opencode:${sourceModel}`,
							sessionId:
								sideChat.session_id === null ? undefined : sideChat.session_id,
							sideChatId: sideChat.id,
							cwd: sourceJob.cwd,
						})
						.pipe(
							Effect.mapError((error) => {
								if (
									error instanceof JobStartError &&
									error.code === 'SIDE_CHAT_TURN_IN_PROGRESS'
								) {
									return new SideChatError({
										code: 'TURN_IN_PROGRESS',
										message: error.message,
									});
								}
								return new SideChatError({
									code: 'SOURCE_NOT_READY',
									message: `Could not reserve the side-chat turn: ${error.message}`,
								});
							}),
							Effect.flatMap((reservation) =>
								Ref.make(false).pipe(
									Effect.map((handedOff) => ({ reservation, handedOff })),
								),
							),
						);

					return yield* Effect.acquireUseRelease(
						acquireReservation,
						(turn) =>
							Effect.gen(function* () {
								const persistForkedSession = (sessionId: string) =>
									Effect.try({
										try: () =>
											db
												.update(schema.sideChats)
												.set({ session_id: sessionId })
												.where(
													and(
														eq(schema.sideChats.id, sideChat.id),
														isNull(schema.sideChats.session_id),
													),
												)
												.returning({ id: schema.sideChats.id })
												.get(),
										catch: (cause) =>
											new SideChatError({
												code: 'FORK_FAILED',
												message: `Could not persist the forked OpenCode session: ${String(cause)}`,
											}),
									}).pipe(
										Effect.flatMap((updated) =>
											updated === undefined
												? new SideChatError({
														code: 'FORK_FAILED',
														message:
															'Side-chat session changed before the fork could be persisted.',
													})
												: Effect.void,
										),
									);

								const forkSession = harnessRegistry.get('opencode').forkSession;
								if (forkSession === undefined) {
									return yield* new SideChatError({
										code: 'FORK_NOT_SUPPORTED',
										message:
											'The OpenCode harness does not support session forking.',
									});
								}
								const forkedSession = forkSession({
									sessionId: sourceSessionId,
									cwd: sourceJob.cwd,
								})
									.pipe(
										Effect.mapError((error) =>
											error instanceof AcpForkNotSupportedError
												? new SideChatError({
														code: 'FORK_NOT_SUPPORTED',
														message: error.message,
													})
												: new SideChatError({
														code: 'FORK_FAILED',
														message: `Could not fork the source OpenCode session: ${error.message}`,
													}),
										),
									)
									.pipe(
										Effect.flatMap((fork) =>
											persistForkedSession(fork.sessionId).pipe(
												Effect.map(() => fork.sessionId),
											),
										),
									);
								const sessionId = yield* sideChat.session_id === null
									? forkedSession
									: Effect.succeed(sideChat.session_id);

								const isFirstTurn = sideChat.first_turn_dispatched_at === null;
								const agentPrompt = isFirstTurn
									? firstSideChatPrompt(input.prompt)
									: input.prompt;
								return yield* jobs
									.runReserved({
										reservation: turn.reservation,
										agentPrompt,
										sessionId,
										onPromptDispatch: isFirstTurn
											? () => {
													db.update(schema.sideChats)
														.set({ first_turn_dispatched_at: new Date() })
														.where(
															and(
																eq(schema.sideChats.id, sideChat.id),
																isNull(
																	schema.sideChats.first_turn_dispatched_at,
																),
															),
														)
														.run();
												}
											: undefined,
									})
									.pipe(
										Effect.mapError(
											(error) =>
												new SideChatError({
													code: 'SOURCE_NOT_READY',
													message: `Could not run the side-chat turn: ${error.message}`,
												}),
										),
										Effect.tap(() => Ref.set(turn.handedOff, true)),
										Effect.uninterruptible,
									);
							}),
						(turn) =>
							Ref.get(turn.handedOff).pipe(
								Effect.flatMap((handedOff) => {
									if (handedOff) return Effect.void;
									return jobs
										.failReserved(
											turn.reservation,
											new SideChatError({
												code: 'SOURCE_NOT_READY',
												message:
													'Side-chat turn ended before it reached the worker.',
											}),
										)
										.pipe(
											Effect.mapError(
												(jobError) =>
													new SideChatError({
														code: 'SOURCE_NOT_READY',
														message: `Could not record the failed side-chat turn: ${jobError.message}`,
													}),
											),
										);
								}),
							),
					);
				});

			return { list, create, send };
		}),
	},
) {
	static readonly layer = Layer.effect(SideChats, SideChats.make).pipe(
		Layer.provide(Jobs.layer),
		Layer.provide(HarnessRegistry.layer),
		Layer.provide(Db.layer),
	);
}
