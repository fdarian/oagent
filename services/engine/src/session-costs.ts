import { and, desc, eq } from 'drizzle-orm';
import { Context, Effect, Layer, Schema } from 'effect';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { Settings } from './settings.ts';

const COMMAND_TIMEOUT_MS = 60_000;
const TokenCounts = Schema.Struct({
	inputTokens: Schema.Number,
	outputTokens: Schema.Number,
	cacheCreationTokens: Schema.Number,
	cacheReadTokens: Schema.Number,
});
const CostEntry = Schema.Struct({
	...TokenCounts.fields,
	totalCost: Schema.Number,
});
const ClaudeCost = Schema.fromJsonString(
	Schema.Struct({
		sessionId: Schema.String,
		totalCost: Schema.Number,
		entries: Schema.Array(TokenCounts),
	}),
);
const CodexCost = Schema.fromJsonString(CostEntry);
const OpenCodeCosts = Schema.fromJsonString(
	Schema.Struct({
		sessions: Schema.Array(
			Schema.Struct({ ...CostEntry.fields, sessionId: Schema.String }),
		),
	}),
);

export class SessionCostError extends Schema.TaggedError<SessionCostError>()(
	'SessionCostError',
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect()),
	},
) {}

type Cost = {
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	totalCostUsd: number;
};

function runCcusage(args: string[], env: Record<string, string>) {
	return Effect.scoped(
		Effect.gen(function* () {
			const child = yield* Effect.acquireRelease(
				Effect.try({
					try: () =>
						Bun.spawn(['bunx', '--yes', 'ccusage@20.0.26', ...args], {
							stdin: 'ignore',
							stdout: 'pipe',
							stderr: 'pipe',
							env,
						}),
					catch: (cause) =>
						new SessionCostError({ message: 'Could not start ccusage', cause }),
				}),
				(child) =>
					Effect.sync(() => {
						if (child.exitCode === null) child.kill();
					}),
			);
			const result = yield* Effect.tryPromise({
				try: () =>
					Promise.all([
						new Response(child.stdout).text(),
						new Response(child.stderr).text(),
						child.exited,
					]),
				catch: (cause) =>
					new SessionCostError({
						message: 'Could not read ccusage output',
						cause,
					}),
			});
			if (result[2] !== 0) {
				return yield* new SessionCostError({
					message: `ccusage exited with code ${result[2]}: ${result[1].trim() || result[0].trim()}`,
				});
			}
			return result[0];
		}),
	).pipe(
		Effect.timeout(COMMAND_TIMEOUT_MS),
		Effect.mapError((cause) =>
			cause instanceof SessionCostError
				? cause
				: new SessionCostError({
						message: 'ccusage timed out after 60 seconds',
						cause,
					}),
		),
	);
}

function computeCost(backend: string, id: string, env: Record<string, string>) {
	return Effect.gen(function* () {
		if (backend === 'claude') {
			const raw = yield* runCcusage(['session', '--json', '--id', id], env);
			const result = yield* Schema.decodeUnknownEffect(ClaudeCost)(raw);
			if (result.sessionId !== id)
				return yield* new SessionCostError({
					message: `No Claude session found with ID: ${id}`,
				});
			const tokens = result.entries.reduce(
				(total, entry) => ({
					inputTokens: total.inputTokens + entry.inputTokens,
					outputTokens: total.outputTokens + entry.outputTokens,
					cacheCreationTokens:
						total.cacheCreationTokens + entry.cacheCreationTokens,
					cacheReadTokens: total.cacheReadTokens + entry.cacheReadTokens,
				}),
				{
					inputTokens: 0,
					outputTokens: 0,
					cacheCreationTokens: 0,
					cacheReadTokens: 0,
				},
			);
			return { ...tokens, totalCostUsd: result.totalCost };
		}
		const raw = yield* runCcusage(
			backend === 'codex'
				? ['codex', 'session', '--json', '--id', id]
				: ['opencode', 'session', '--json'],
			env,
		);
		const entry =
			backend === 'codex'
				? yield* Schema.decodeUnknownEffect(CodexCost)(raw)
				: (yield* Schema.decodeUnknownEffect(OpenCodeCosts)(raw)).sessions.find(
						(entry) => entry.sessionId === id,
					);
		if (entry === undefined)
			return yield* new SessionCostError({
				message: `No OpenCode session found with ID: ${id}`,
			});
		return {
			inputTokens: entry.inputTokens,
			outputTokens: entry.outputTokens,
			cacheCreationTokens: entry.cacheCreationTokens,
			cacheReadTokens: entry.cacheReadTokens,
			totalCostUsd: entry.totalCost,
		};
	}).pipe(
		Effect.mapError((cause) =>
			cause instanceof SessionCostError
				? cause
				: new SessionCostError({
						message: `Invalid ccusage ${backend} response`,
						cause,
					}),
		),
	);
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
				Effect.Effect<Cost & { computedAt: number }, SessionCostError>
			>();
			const dedupe = (
				id: number,
				work: Effect.Effect<Cost & { computedAt: number }, SessionCostError>,
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
					if (!['claude', 'codex', 'opencode'].includes(session.backend))
						return { status: 'unsupported' as const };
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
							const env = {
								...Object.fromEntries(
									Object.entries(Bun.env).flatMap((entry) =>
										typeof entry[1] === 'string' ? [[entry[0], entry[1]]] : [],
									),
								),
								...(session.backend === 'codex' && codexHome !== undefined
									? { CODEX_HOME: codexHome }
									: {}),
							};
							const cost = yield* computeCost(session.backend, harnessId, env);
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
