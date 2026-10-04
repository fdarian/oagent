import {
	type Harness,
	type SessionCost,
	SessionNotFoundError,
	sessionCost,
} from 'ccusage-lib';
import { and, desc, eq } from 'drizzle-orm';
import { Context, Effect, Layer, Schema } from 'effect';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { Settings } from './settings.ts';

export class SessionCostError extends Schema.TaggedError<SessionCostError>()(
	'SessionCostError',
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect()),
	},
) {}

const costHarnesses = new Map<string, Harness>([
	['claude', 'claude'],
	['codex', 'codex'],
	['opencode', 'opencode'],
]);

function computeCost(
	harness: Harness,
	sessionId: string,
	codexHome: string | undefined,
) {
	return Effect.tryPromise({
		try: () =>
			sessionCost({
				harness,
				sessionId,
				env:
					harness === 'codex' && codexHome !== undefined
						? { CODEX_HOME: codexHome }
						: undefined,
			}),
		catch: (cause) =>
			new SessionCostError({
				message:
					cause instanceof SessionNotFoundError
						? `No ${harness} session found with ID: ${sessionId}`
						: `Could not compute ${harness} session cost: ${cause instanceof Error ? cause.message : String(cause)}`,
				cause,
			}),
	});
}

export class SessionCosts extends Context.Service<SessionCosts>()(
	'oagent/SessionCosts',
	{
		make: Effect.gen(function* () {
			const dbService = yield* Db;
			const db = dbService.db;
			const settings = yield* Settings;
			const inFlight = new Map<
				number,
				Effect.Effect<SessionCost & { computedAt: number }, SessionCostError>
			>();
			const dedupe = (
				id: number,
				work: Effect.Effect<
					SessionCost & { computedAt: number },
					SessionCostError
				>,
			) =>
				Effect.uninterruptibleMask((restore) =>
					Effect.gen(function* () {
						const existing = inFlight.get(id);
						if (existing !== undefined) return yield* restore(existing);
						const computation = yield* Effect.cached(restore(work));
						inFlight.set(id, computation);
						return yield* restore(computation).pipe(
							Effect.ensuring(
								Effect.sync(() => {
									if (inFlight.get(id) === computation) inFlight.delete(id);
								}),
							),
						);
					}),
				);
			const get = (sessionId: string) =>
				Effect.gen(function* () {
					const session = yield* Effect.try({
						try: () =>
							db
								.select()
								.from(schema.sessions)
								.where(eq(schema.sessions.uuid, sessionId))
								.get(),
						catch: (cause) =>
							new SessionCostError({
								message: 'Could not read session',
								cause,
							}),
					});
					if (session === undefined)
						return yield* new SessionCostError({
							message: `Session not found: ${sessionId}`,
						});
					const harness = costHarnesses.get(session.backend);
					if (harness === undefined) return { status: 'unsupported' as const };
					if (session.harness_session_id === null)
						return yield* new SessionCostError({
							message: 'Harness session ID is not available yet',
						});
					const harnessId = session.harness_session_id;
					const state = () =>
						Effect.try({
							try: () => ({
								cached: db
									.select()
									.from(schema.sessionCosts)
									.where(eq(schema.sessionCosts.session_id, session.id))
									.get(),
								latest: db
									.select()
									.from(schema.jobs)
									.where(eq(schema.jobs.session_id, session.id))
									.orderBy(desc(schema.jobs.terminated_at))
									.limit(1)
									.get(),
								running:
									db
										.select({ id: schema.jobs.id })
										.from(schema.jobs)
										.where(
											and(
												eq(schema.jobs.session_id, session.id),
												eq(schema.jobs.status, 'running'),
											),
										)
										.limit(1)
										.get() !== undefined,
							}),
							catch: (cause) =>
								new SessionCostError({
									message: 'Could not read session cost cache',
									cause,
								}),
						});
					const current = yield* state();
					const cached = current.cached;
					if (
						cached !== undefined &&
						(current.latest?.terminated_at == null ||
							current.latest.terminated_at.getTime() <=
								cached.computed_at.getTime())
					) {
						return {
							status: 'ready' as const,
							inputTokens: cached.input_tokens,
							outputTokens: cached.output_tokens,
							cacheCreationTokens: cached.cache_creation_tokens,
							cacheReadTokens: cached.cache_read_tokens,
							totalCostUsd: cached.total_cost_usd,
							computedAt: cached.computed_at.getTime(),
							stale: current.running,
						};
					}
					const cost = yield* dedupe(
						session.id,
						Effect.gen(function* () {
							// Timestamp the start so a turn ending during the scan invalidates this snapshot.
							const computedAt = new Date();
							const codexHome = settings.getCodexHome();
							const cost = yield* computeCost(harness, harnessId, codexHome);
							yield* Effect.try({
								try: () => {
									const values = {
										session_id: session.id,
										input_tokens: cost.inputTokens,
										output_tokens: cost.outputTokens,
										cache_creation_tokens: cost.cacheCreationTokens,
										cache_read_tokens: cost.cacheReadTokens,
										total_cost_usd: cost.totalCostUsd,
										computed_at: computedAt,
									};
									db.insert(schema.sessionCosts)
										.values(values)
										.onConflictDoUpdate({
											target: schema.sessionCosts.session_id,
											set: values,
										})
										.run();
								},
								catch: (cause) =>
									new SessionCostError({
										message: 'Could not cache session cost',
										cause,
									}),
							});
							return { ...cost, computedAt: computedAt.getTime() };
						}),
					);
					const after = yield* state();
					return {
						status: 'ready' as const,
						...cost,
						stale:
							after.running ||
							(after.latest?.terminated_at !== null &&
								after.latest?.terminated_at !== undefined &&
								after.latest.terminated_at.getTime() > cost.computedAt),
					};
				});
			return { get };
		}),
	},
) {
	static readonly layer = Layer.effect(SessionCosts, SessionCosts.make).pipe(
		Layer.provide(Settings.layer),
		Layer.provide(Db.layer),
	);
}
