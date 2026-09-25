import { eq } from 'drizzle-orm';
import { Context, Effect, Layer, Schema } from 'effect';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import type {
	Backend,
	HarnessAuthStatus,
	HarnessCancelLoginResult,
	HarnessCheckResult,
	HarnessLoginResult,
} from './harness.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { OpenCodeServiceClient } from './opencode-service-client.ts';

export type HarnessRecord = {
	backend: Backend;
	binaryPath: string;
	version: string | undefined;
	detectedAt: Date;
};

export type { HarnessCheckResult } from './harness.ts';

export class HarnessesError extends Schema.TaggedError<HarnessesError>()(
	'HarnessesError',
	{
		operation: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		const detail =
			this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `${this.operation} failed: ${detail}`;
	}
}

export class Harnesses extends Context.Service<Harnesses>()(
	'oagent/Harnesses',
	{
		make: Effect.gen(function* () {
			const dbService = yield* Db;
			const harnessRegistry = yield* HarnessRegistry;
			const serviceClient = yield* OpenCodeServiceClient;
			const serviceControl = (action: 'start' | 'stop') =>
				Effect.gen(function* () {
					const binary = harnessRegistry.get('opencode').resolveBinary();
					if (binary === undefined)
						return yield* new HarnessesError({
							operation: `service ${action}`,
							cause: new Error('OpenCode binary not detected'),
						});
					yield* serviceClient
						.serviceControl(binary, action)
						.pipe(
							Effect.mapError(
								(cause) =>
									new HarnessesError({ operation: `service ${action}`, cause }),
							),
						);
					return { ok: true as const };
				});

			const readList = (): ReadonlyArray<HarnessRecord> => {
				const rows = dbService.db.select().from(schema.harnesses).all();
				const rowsByBackend = new Map(rows.map((row) => [row.backend, row]));
				return harnessRegistry.all.flatMap((harness) => {
					const row = rowsByBackend.get(harness.backend);
					if (row === undefined) return [];
					return [
						{
							backend: harness.backend,
							binaryPath: row.binary_path,
							version: row.version === null ? undefined : row.version,
							detectedAt: row.detected_at,
						},
					];
				});
			};

			const list = (): Effect.Effect<
				ReadonlyArray<HarnessRecord>,
				HarnessesError
			> =>
				Effect.try({
					try: readList,
					catch: (cause) => new HarnessesError({ operation: 'list', cause }),
				});

			const refresh = (): Effect.Effect<
				ReadonlyArray<HarnessRecord>,
				HarnessesError
			> =>
				Effect.gen(function* () {
					const detected = yield* Effect.try({
						try: () =>
							harnessRegistry.all.flatMap((harness) => {
								const binaryPath = harness.resolveBinary();
								if (binaryPath === undefined) return [];
								return [{ harness, binaryPath }];
							}),
						catch: (cause) =>
							new HarnessesError({ operation: 'refresh', cause }),
					});
					const detectedBackends = new Set(
						detected.map((entry) => entry.harness.backend),
					);
					const versions = new Map<Backend, string | undefined>();
					for (const entry of detected) {
						yield* entry.harness.invalidate();
						const version = yield* entry.harness.version().pipe(
							Effect.mapError(
								(cause) => new HarnessesError({ operation: 'refresh', cause }),
							),
							Effect.catchTag('HarnessesError', (error) =>
								Effect.logWarning(
									`Failed to detect ${entry.harness.backend} version: ${error.message}`,
								).pipe(Effect.map(() => undefined)),
							),
						);
						versions.set(entry.harness.backend, version);
					}
					const detectedAt = new Date();

					yield* Effect.try({
						try: () => {
							dbService.db.transaction((tx) => {
								for (const entry of detected) {
									const version = versions.get(entry.harness.backend);
									tx.insert(schema.harnesses)
										.values({
											backend: entry.harness.backend,
											binary_path: entry.binaryPath,
											version: version === undefined ? null : version,
											detected_at: detectedAt,
										})
										.onConflictDoUpdate({
											target: schema.harnesses.backend,
											set: {
												binary_path: entry.binaryPath,
												version: version === undefined ? null : version,
												detected_at: detectedAt,
											},
										})
										.run();
								}

								for (const harness of harnessRegistry.all) {
									if (detectedBackends.has(harness.backend)) continue;
									tx.delete(schema.harnesses)
										.where(eq(schema.harnesses.backend, harness.backend))
										.run();
								}
							});
						},
						catch: (cause) =>
							new HarnessesError({ operation: 'refresh', cause }),
					});

					return yield* Effect.try({
						try: readList,
						catch: (cause) =>
							new HarnessesError({ operation: 'refresh', cause }),
					});
				});

			const check = (
				backend: Backend,
			): Effect.Effect<HarnessCheckResult, HarnessesError> =>
				Effect.gen(function* () {
					const detected = yield* list();
					const harness = detected.find((entry) => entry.backend === backend);
					if (harness === undefined) {
						return {
							backend,
							ok: false as const,
							message:
								'Harness is not detected. Refresh detection and try again.',
						};
					}

					const behavior = harnessRegistry.get(backend);

					return yield* behavior.check().pipe(
						Effect.tap((result) =>
							result.ok && 'agentVersion' in result
								? Effect.try({
										try: () =>
											dbService.db
												.update(schema.harnesses)
												.set({
													version:
														result.agentVersion === undefined
															? null
															: result.agentVersion,
												})
												.where(eq(schema.harnesses.backend, backend))
												.run(),
										catch: (cause) =>
											new HarnessesError({ operation: 'check', cause }),
									})
								: Effect.void,
						),
					);
				});

			const authStatus = (
				backend: Backend,
			): Effect.Effect<HarnessAuthStatus, HarnessesError> => {
				const auth = harnessRegistry.get(backend).auth;
				if (auth === undefined) {
					return Effect.succeed({ backend, status: 'unsupported' });
				}
				return auth
					.authStatus()
					.pipe(
						Effect.mapError(
							(cause) => new HarnessesError({ operation: 'authStatus', cause }),
						),
					);
			};

			const login = (
				backend: Backend,
			): Effect.Effect<HarnessLoginResult, HarnessesError> => {
				const auth = harnessRegistry.get(backend).auth;
				if (auth === undefined) {
					return Effect.succeed({ backend, status: 'unsupported' });
				}
				return auth
					.login()
					.pipe(
						Effect.mapError(
							(cause) => new HarnessesError({ operation: 'login', cause }),
						),
					);
			};

			const cancelLogin = (
				backend: Backend,
			): Effect.Effect<HarnessCancelLoginResult, HarnessesError> => {
				const auth = harnessRegistry.get(backend).auth;
				if (auth === undefined) {
					return Effect.succeed({ backend, cancelled: false });
				}
				return auth
					.cancelLogin()
					.pipe(
						Effect.mapError(
							(cause) =>
								new HarnessesError({ operation: 'cancelLogin', cause }),
						),
					);
			};

			const logout = (
				backend: Backend,
			): Effect.Effect<HarnessAuthStatus, HarnessesError> => {
				const auth = harnessRegistry.get(backend).auth;
				if (auth === undefined) {
					return Effect.succeed({ backend, status: 'unsupported' });
				}
				return auth
					.logout()
					.pipe(
						Effect.mapError(
							(cause) => new HarnessesError({ operation: 'logout', cause }),
						),
					);
			};

			return {
				list,
				refresh,
				check,
				authStatus,
				login,
				cancelLogin,
				logout,
				serviceControl,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(Harnesses, Harnesses.make).pipe(
		Layer.provide(Db.layer),
		Layer.provideMerge(HarnessRegistry.layer),
		Layer.provide(OpenCodeServiceClient.layer),
	);
}
