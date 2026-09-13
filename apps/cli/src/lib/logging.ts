import { Effect, Exit, Layer, Logger, Schema, Semaphore } from 'effect';
import type { FileSystem as FileSystemService } from 'effect/FileSystem';
import { FileSystem } from 'effect/FileSystem';
import { Path } from 'effect/Path';
import type { Scope } from 'effect/Scope';

const retentionDays = 30;
const logRecordSchema = Schema.fromJsonString(
	Schema.Struct({ timestamp: Schema.String }),
);
const decodeLogRecord = Schema.decodeUnknownExit(logRecordSchema);

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

function loggingError(operation: string, cause: unknown): LoggingError {
	return new LoggingError({ operation, cause });
}

function getRetentionCutoff(now: Date): number {
	const cutoff = new Date(now.getTime());
	cutoff.setDate(cutoff.getDate() - retentionDays);
	return cutoff.getTime();
}

function getLogTimestamp(line: string): number | undefined {
	const decoded = decodeLogRecord(line);
	if (Exit.isFailure(decoded)) {
		return undefined;
	}

	const timestamp = Date.parse(decoded.value.timestamp);
	return Number.isNaN(timestamp) ? undefined : timestamp;
}

export function filterRetainedLogLines(
	lines: ReadonlyArray<string>,
	now: Date,
): {
	readonly lines: ReadonlyArray<string>;
	readonly unparseableCount: number;
} {
	const cutoff = getRetentionCutoff(now);
	const retainedLines: Array<string> = [];
	let unparseableCount = 0;

	for (const line of lines) {
		const timestamp = getLogTimestamp(line);
		if (timestamp === undefined) {
			unparseableCount += 1;
			continue;
		}
		if (timestamp >= cutoff) {
			retainedLines.push(line);
		}
	}

	return { lines: retainedLines, unparseableCount };
}

function splitLogLines(content: string): ReadonlyArray<string> {
	const lines = content.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') {
		return lines.slice(0, -1);
	}
	return lines;
}

function formatLogLines(lines: ReadonlyArray<string>): string {
	return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function pruneLogFile(
	logFile: string,
): Effect.Effect<number, LoggingError, FileSystem | Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const path = yield* Path;
		const content = yield* fs
			.readFileString(logFile)
			.pipe(
				Effect.catchTag('PlatformError', (error) =>
					error.reason._tag === 'NotFound'
						? Effect.succeed(undefined)
						: Effect.fail(
								loggingError(`Failed to read log file ${logFile}`, error),
							),
				),
			);
		if (content === undefined) {
			return 0;
		}

		const result = filterRetainedLogLines(splitLogLines(content), new Date());
		const tempFile = yield* fs
			.makeTempFile({
				directory: path.dirname(logFile),
				prefix: '.oagent-',
				suffix: '.jsonl.tmp',
			})
			.pipe(
				Effect.mapError((cause) =>
					loggingError(
						`Failed to create temporary log file for ${logFile}`,
						cause,
					),
				),
			);

		yield* Effect.gen(function* () {
			yield* fs
				.writeFileString(tempFile, formatLogLines(result.lines))
				.pipe(
					Effect.mapError((cause) =>
						loggingError(`Failed to rewrite log file ${logFile}`, cause),
					),
				);
			yield* fs
				.rename(tempFile, logFile)
				.pipe(
					Effect.mapError((cause) =>
						loggingError(`Failed to replace log file ${logFile}`, cause),
					),
				);
		}).pipe(
			Effect.ensuring(fs.remove(tempFile, { force: true }).pipe(Effect.ignore)),
		);

		return result.unparseableCount;
	});
}

function millisecondsUntilNextLocalMidnight(now: Date): number {
	const nextMidnight = new Date(now.getTime());
	nextMidnight.setHours(24, 0, 0, 0);
	return Math.max(nextMidnight.getTime() - now.getTime(), 1);
}

function logUnparseableWarning(
	logFile: string,
	unparseableCount: number,
): Effect.Effect<void> {
	return unparseableCount === 0
		? Effect.void
		: Effect.logWarning(
				`Dropped ${unparseableCount} log line(s) with an invalid timestamp while pruning ${logFile}`,
			);
}

function pruneWithWarning(
	logFile: string,
	semaphore: Semaphore.Semaphore,
): Effect.Effect<void, never, FileSystem | Path> {
	return semaphore.withPermit(pruneLogFile(logFile)).pipe(
		Effect.catchTag('LoggingError', (error) =>
			Effect.logWarning(
				`Failed to prune old oagent logs in ${logFile}`,
				error,
			).pipe(Effect.as(0)),
		),
		Effect.flatMap((unparseableCount) =>
			logUnparseableWarning(logFile, unparseableCount),
		),
	);
}

function createDailyPruneLoop(
	logFile: string,
	semaphore: Semaphore.Semaphore,
): Effect.Effect<never, never, FileSystem | Path> {
	return Effect.gen(function* () {
		while (true) {
			yield* Effect.sleep(millisecondsUntilNextLocalMidnight(new Date()));
			yield* pruneWithWarning(logFile, semaphore);
		}
	});
}

function createBatchedFileLogger(
	logFile: string,
	semaphore: Semaphore.Semaphore,
	fs: FileSystemService,
): Effect.Effect<Logger.Logger<unknown, void>, never, Scope> {
	return Logger.batched(Logger.formatJson, {
		window: 100,
		flush: (lines) =>
			semaphore.withPermit(
				fs
					.writeFileString(logFile, `${lines.join('\n')}\n`, { flag: 'a' })
					.pipe(Effect.ignore),
			),
	});
}

function createFileLayer(
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

			const semaphore = yield* Semaphore.make(1);
			const logger = yield* createBatchedFileLogger(
				resolvedPath,
				semaphore,
				fs,
			);
			const loggerLayer = Logger.layer([Logger.tracerLogger, logger]);

			yield* semaphore.withPermit(pruneLogFile(resolvedPath)).pipe(
				Effect.flatMap((unparseableCount) =>
					logUnparseableWarning(resolvedPath, unparseableCount),
				),
				Effect.provide(loggerLayer),
			);
			yield* Effect.forkScoped(
				createDailyPruneLoop(resolvedPath, semaphore).pipe(
					Effect.provide(loggerLayer),
				),
			);

			return loggerLayer;
		}),
	);
}

export function getLoggerLayer(
	logFile: string | undefined,
): Layer.Layer<never, LoggingError, FileSystem | Path> {
	return logFile === undefined
		? Logger.layer([Logger.tracerLogger, Logger.consolePretty()])
		: createFileLayer(logFile);
}
