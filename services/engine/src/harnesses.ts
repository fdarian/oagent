import { eq } from 'drizzle-orm';
import { Context, Effect, Layer, Schema } from 'effect';
import { type AcpAgentConfig, probeAcpConnection } from './acp-agent.ts';
import { createCodexAcpConfig, resolveCodexBinary } from './codex.ts';
import { createCursorAcpConfig, resolveCursorBinary } from './cursor.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { createGrokAcpConfig, resolveGrokBinary } from './grok.ts';
import type { Backend } from './model-catalog.ts';
import { createOpenCodeAcpConfig, resolveOpenCodeBinary } from './opencode.ts';
import { Settings } from './settings.ts';

export type Harness = {
	backend: Backend;
	binaryPath: string;
	detectedAt: Date;
};

export type HarnessCheckResult =
	| {
			backend: Backend;
			ok: true;
			agentName?: string;
			agentVersion?: string;
	  }
	| {
			backend: Backend;
			ok: false;
			message: string;
	  };

export class HarnessesError extends Schema.TaggedError<HarnessesError>()(
	'HarnessesError',
	{
		operation: Schema.String,
		cause: Schema.Defect(),
	},
) {}

type HarnessDefinition = {
	backend: Backend;
	resolveBinary: () => string | undefined;
	createConfig: () => AcpAgentConfig;
};

export class Harnesses extends Context.Service<Harnesses>()(
	'oagent/Harnesses',
	{
		make: Effect.gen(function* () {
			const dbService = yield* Db;
			const settings = yield* Settings;

			const definitions: ReadonlyArray<HarnessDefinition> = [
				{
					backend: 'opencode',
					resolveBinary: resolveOpenCodeBinary,
					createConfig: createOpenCodeAcpConfig,
				},
				{
					backend: 'cursor',
					resolveBinary: resolveCursorBinary,
					createConfig: createCursorAcpConfig,
				},
				{
					backend: 'grok',
					resolveBinary: resolveGrokBinary,
					createConfig: () => createGrokAcpConfig(),
				},
				{
					backend: 'codex',
					resolveBinary: resolveCodexBinary,
					createConfig: () => createCodexAcpConfig(settings.getCodexHome),
				},
			];

			const readList = (): ReadonlyArray<Harness> => {
				const rows = dbService.db.select().from(schema.harnesses).all();
				const rowsByBackend = new Map(rows.map((row) => [row.backend, row]));
				return definitions.flatMap((definition) => {
					const row = rowsByBackend.get(definition.backend);
					if (row === undefined) return [];
					return [
						{
							backend: definition.backend,
							binaryPath: row.binary_path,
							detectedAt: row.detected_at,
						},
					];
				});
			};

			const list = (): Effect.Effect<ReadonlyArray<Harness>, HarnessesError> =>
				Effect.try({
					try: readList,
					catch: (cause) => new HarnessesError({ operation: 'list', cause }),
				});

			const refresh = (): Effect.Effect<
				ReadonlyArray<Harness>,
				HarnessesError
			> =>
				Effect.try({
					try: () => {
						const detected = definitions.flatMap((definition) => {
							const binaryPath = definition.resolveBinary();
							if (binaryPath === undefined) return [];
							return [{ definition, binaryPath }];
						});
						const detectedBackends = new Set(
							detected.map((entry) => entry.definition.backend),
						);
						const detectedAt = new Date();

						dbService.db.transaction((tx) => {
							for (const entry of detected) {
								tx.insert(schema.harnesses)
									.values({
										backend: entry.definition.backend,
										binary_path: entry.binaryPath,
										detected_at: detectedAt,
									})
									.onConflictDoUpdate({
										target: schema.harnesses.backend,
										set: {
											binary_path: entry.binaryPath,
											detected_at: detectedAt,
										},
									})
									.run();
							}

							for (const definition of definitions) {
								if (detectedBackends.has(definition.backend)) continue;
								tx.delete(schema.harnesses)
									.where(eq(schema.harnesses.backend, definition.backend))
									.run();
							}
						});

						return readList();
					},
					catch: (cause) => new HarnessesError({ operation: 'refresh', cause }),
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

					const definition = definitions.find(
						(entry) => entry.backend === harness.backend,
					);
					if (definition === undefined) {
						return {
							backend,
							ok: false as const,
							message: `No connection configuration exists for ${backend}.`,
						};
					}

					return yield* probeAcpConnection(definition.createConfig()).pipe(
						Effect.map((info) => ({ backend, ok: true as const, ...info })),
						Effect.catchTag('AcpSessionError', (error) =>
							Effect.succeed({
								backend,
								ok: false as const,
								message: error.message,
							}),
						),
					);
				});

			return { list, refresh, check };
		}),
	},
) {
	static readonly layer = Layer.effect(Harnesses, Harnesses.make).pipe(
		Layer.provide(Db.layer),
		Layer.provide(Settings.layer),
	);
}
