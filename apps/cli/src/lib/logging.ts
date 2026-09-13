import { Effect, Layer, Logger, Schema } from 'effect';
import { FileSystem } from 'effect/FileSystem';
import { Path } from 'effect/Path';
import type { Scope } from 'effect/Scope';

const dailyLogFilePattern = /^oagent-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const retentionDays = 30;

export class LoggingError extends Schema.TaggedError<LoggingError>()(
	'LoggingError',
	{
		operation: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		return `${this.operation}: ${String(this.cause)}`;
	}
}

type JsonLogEntry = {
	readonly date: Date;
	readonly line: string;
};

function formatLocalDate(date: Date): string {
	const year = String(date.getFullYear()).padStart(4, '0');
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function getDailyLogFileName(date: Date): string {
	return `oagent-${formatLocalDate(date)}.jsonl`;
}

function getCapturedLogDate(fileName: string): string | undefined {
	const match = fileName.match(dailyLogFilePattern);
	return match === null ? undefined : match[1];
}

function getRetentionCutoffDate(now: Date): string {
	const cutoff = new Date(now.getTime());
	cutoff.setHours(0, 0, 0, 0);
	cutoff.setDate(cutoff.getDate() - retentionDays);
	return formatLocalDate(cutoff);
}

export function filterExpiredLogFiles(
	fileNames: ReadonlyArray<string>,
	now: Date,
): ReadonlyArray<string> {
	const cutoffDate = getRetentionCutoffDate(now);
	return fileNames.filter((fileName) => {
		const fileDate = getCapturedLogDate(fileName);
		return fileDate !== undefined && fileDate < cutoffDate;
	});
}

function loggingError(operation: string, cause: unknown): LoggingError {
	return new LoggingError({ operation, cause });
}

function ensureLogDirectory(
	logDir: string,
): Effect.Effect<string, LoggingError, FileSystem | Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const resolvedDir = path.resolve(logDir);
		yield* fs
			.makeDirectory(resolvedDir, { recursive: true })
			.pipe(
				Effect.mapError((cause) =>
					loggingError(`Failed to create log directory ${resolvedDir}`, cause),
				),
			);
		return resolvedDir;
	});
}

function pruneExpiredLogFiles(
	logDir: string,
): Effect.Effect<void, LoggingError, FileSystem | Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const fileNames = yield* fs
			.readDirectory(logDir)
			.pipe(
				Effect.mapError((cause) =>
					loggingError(`Failed to read log directory ${logDir}`, cause),
				),
			);

		for (const fileName of filterExpiredLogFiles(fileNames, new Date())) {
			const filePath = path.join(logDir, fileName);
			const info = yield* fs
				.stat(filePath)
				.pipe(
					Effect.mapError((cause) =>
						loggingError(`Failed to inspect log file ${filePath}`, cause),
					),
				);
			if (info.type !== 'File') {
				continue;
			}

			yield* fs
				.remove(filePath, { force: true })
				.pipe(
					Effect.mapError((cause) =>
						loggingError(
							`Failed to remove expired log file ${filePath}`,
							cause,
						),
					),
				);
		}
	});
}

function millisecondsUntilNextLocalMidnight(now: Date): number {
	const nextMidnight = new Date(now.getTime());
	nextMidnight.setHours(24, 0, 0, 0);
	return Math.max(nextMidnight.getTime() - now.getTime(), 1);
}

function pruneWithWarning(
	logDir: string,
): Effect.Effect<void, never, FileSystem | Path> {
	return pruneExpiredLogFiles(logDir).pipe(
		Effect.catchTag('LoggingError', (error) =>
			Effect.logWarning(`Failed to prune old oagent logs in ${logDir}`, error),
		),
	);
}

function createDailyPruneLoop(
	logDir: string,
): Effect.Effect<never, never, FileSystem | Path> {
	return Effect.gen(function* () {
		while (true) {
			yield* Effect.sleep(millisecondsUntilNextLocalMidnight(new Date()));
			yield* pruneWithWarning(logDir);
		}
	});
}

function createDailyBatchedLogger(
	logDir: string,
): Effect.Effect<
	Logger.Logger<unknown, void>,
	never,
	Scope | FileSystem | Path
> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const jsonLogger = Logger.make(
			(options): JsonLogEntry => ({
				date: options.date,
				line: Logger.formatJson.log(options),
			}),
		);

		return yield* Logger.batched(jsonLogger, {
			window: 100,
			flush: (entries) =>
				Effect.gen(function* () {
					const linesByPath = new Map<string, Array<string>>();

					for (const entry of entries) {
						const filePath = path.join(logDir, getDailyLogFileName(entry.date));
						const lines = linesByPath.get(filePath);
						if (lines === undefined) {
							linesByPath.set(filePath, [entry.line]);
							continue;
						}
						lines.push(entry.line);
					}

					for (const filePath of linesByPath.keys()) {
						const lines = linesByPath.get(filePath);
						if (lines === undefined) {
							continue;
						}

						yield* fs
							.writeFileString(filePath, `${lines.join('\n')}\n`, {
								flag: 'a',
							})
							.pipe(Effect.ignore);
					}
				}),
		});
	});
}

function createSingleFileLayer(
	logFile: string,
): Layer.Layer<never, LoggingError, FileSystem | Path> {
	return Layer.unwrap(
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const path = yield* Path;
			const resolvedPath = path.resolve(logFile);
			yield* fs
				.makeDirectory(path.dirname(resolvedPath), { recursive: true })
				.pipe(
					Effect.mapError((cause) =>
						loggingError(
							`Failed to create log directory for ${resolvedPath}`,
							cause,
						),
					),
				);

			const fileLogger = yield* Logger.toFile(Logger.formatJson, resolvedPath, {
				batchWindow: 100,
			}).pipe(
				Effect.mapError((cause) =>
					loggingError(`Failed to open log file ${resolvedPath}`, cause),
				),
			);

			return Logger.layer([Logger.tracerLogger, fileLogger]);
		}),
	);
}

function createDailyDirectoryLayer(
	logDir: string,
): Layer.Layer<never, LoggingError, FileSystem | Path> {
	return Layer.unwrap(
		Effect.gen(function* () {
			const resolvedDir = yield* ensureLogDirectory(logDir);
			yield* pruneExpiredLogFiles(resolvedDir);
			yield* Effect.forkScoped(createDailyPruneLoop(resolvedDir));
			const logger = yield* createDailyBatchedLogger(resolvedDir);
			return Logger.layer([Logger.tracerLogger, logger]);
		}),
	);
}

export function getLoggerLayer(params: {
	logFile: string | undefined;
	logDir: string | undefined;
}): Layer.Layer<never, LoggingError, FileSystem | Path> {
	if (params.logFile !== undefined) {
		return createSingleFileLayer(params.logFile);
	}
	if (params.logDir !== undefined) {
		return createDailyDirectoryLayer(params.logDir);
	}
	return Logger.layer([Logger.tracerLogger, Logger.consolePretty()]);
}
