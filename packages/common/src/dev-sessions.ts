import * as platform from '@effect/platform';
import { Array as A, Effect, Layer, Option } from 'effect';
import * as S from 'effect/Schema';
import { generateSlug } from 'random-word-slugs';

namespace DevSession {
	type DevSessionInput = {
		name: string;
		lastModifiedAt: Date | null;
		rootDir: string;
		pathJoin: (relativePath: string) => string;
	};

	export function make(input: DevSessionInput) {
		return {
			name: input.name,
			lastModifiedAt: input.lastModifiedAt,
			path: (relativePath: string) =>
				Effect.succeed(input.pathJoin(relativePath)),
			toString: () => input.name,
		};
	}
}

export namespace DevSessionFile {
	type Shape = S.Schema.Any;

	function getPath(session: DevSession) {
		return Effect.gen(function* () {
			return yield* session.path('sess.json');
		});
	}

	function read(filePath: string) {
		return Effect.gen(function* () {
			const fs = yield* platform.FileSystem.FileSystem;
			if (!(yield* fs.exists(filePath))) {
				return null;
			}

			return yield* fs.readFileString(filePath);
		});
	}

	function get<T extends Shape>(session: DevSession, schema: T) {
		return Effect.gen(function* () {
			const filePath = yield* getPath(session);

			const content = yield* read(filePath);
			if (content == null) return null;

			return yield* S.decode(S.parseJson(schema, {}))(content).pipe(
				Effect.catchTag('ParseError', () => Effect.succeed(null)),
			);
		});
	}
	function set<T extends Shape>(session: DevSession, data: T['Type']) {
		return Effect.gen(function* () {
			const fs = yield* platform.FileSystem.FileSystem;
			const path = yield* platform.Path.Path;
			const filePath = yield* getPath(session);

			yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });

			const existing = yield* read(filePath);
			const parsed = JSON.parse(existing ?? '{}') as Record<string, unknown>;
			const merged = { ...parsed, ...(data as Record<string, unknown>) };

			yield* fs.writeFileString(filePath, JSON.stringify(merged));
		});
	}

	export function make<T extends Shape>(schema: T) {
		return {
			get: (session: DevSession) => get(session, schema),
			set: (session: DevSession, data: T['Type']) => set(session, data),
		};
	}
}

export type DevSession = ReturnType<typeof DevSession.make>;

export class DevSessions extends Effect.Tag('oagent/DevSessions')<
	DevSessions,
	{
		readonly dir: string;
		readonly path: (relativePath: string) => string;
		readonly getSessions: Effect.Effect<
			Array<DevSession>,
			platform.Error.PlatformError
		>;
		readonly createSession: Effect.Effect<
			DevSession,
			platform.Error.PlatformError
		>;
		readonly getLatestOrCreate: Effect.Effect<
			DevSession,
			platform.Error.PlatformError
		>;
	}
>() {}

export const makeDevSessionsLayer = (rootDir: string) =>
	Layer.effect(
		DevSessions,
		Effect.gen(function* () {
			const fs = yield* platform.FileSystem.FileSystem;
			const path = yield* platform.Path.Path;

			yield* Effect.logDebug(`DevSessions dir: ${rootDir}`);
			const getPath = (relativePath: string) =>
				path.join(rootDir, relativePath);

			const getSessions = Effect.gen(function* () {
				const entries = yield* fs
					.readDirectory(rootDir)
					.pipe(Effect.catchAll(() => Effect.succeed([] as Array<string>)));

				const possibleSessions = yield* Effect.all(
					entries.map((entry) =>
						Effect.gen(function* () {
							const stat = yield* fs.stat(getPath(entry));
							if (stat.type !== 'Directory') return Option.none();
							return Option.some(
								DevSession.make({
									name: entry,
									lastModifiedAt: Option.getOrNull(stat.mtime),
									rootDir,
									pathJoin: (relativePath: string) =>
										path.join(rootDir, entry, relativePath),
								}),
							);
						}),
					),
					{ concurrency: 'unbounded' },
				);

				return A.getSomes(possibleSessions);
			});

			const createSession = Effect.gen(function* () {
				const slug = generateSlug(1, { partsOfSpeech: ['noun'] });
				yield* fs.makeDirectory(getPath(slug), { recursive: true });
				return DevSession.make({
					name: slug,
					lastModifiedAt: null,
					rootDir,
					pathJoin: (relativePath: string) =>
						path.join(rootDir, slug, relativePath),
				});
			});

			return {
				dir: rootDir,
				path: getPath,
				getSessions,
				createSession,
				getLatestOrCreate: Effect.gen(function* () {
					yield* fs.makeDirectory(rootDir, { recursive: true });

					const sessions = yield* getSessions;
					if (sessions.length > 0) {
						sessions.sort(
							(a, b) =>
								(b.lastModifiedAt?.getTime() ?? 0) -
								(a.lastModifiedAt?.getTime() ?? 0),
						);
						const latest = sessions[0];
						return latest as DevSession;
					}

					return yield* createSession;
				}),
			};
		}),
	);
