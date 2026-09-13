import fs from 'node:fs';
import path from 'node:path';
import { Effect, type Layer, Logger } from 'effect';

const dailyLogFilePattern = /^oagent-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;
const retentionDays = 30;

type LoggerSetup = {
	layer: Layer.Layer<never, never, never>;
	maintenance: Effect.Effect<void>;
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

function parseDailyLogDate(fileName: string): string | undefined {
	const match = fileName.match(dailyLogFilePattern);
	if (match === null) {
		return undefined;
	}

	const yearText = match[1];
	const monthText = match[2];
	const dayText = match[3];
	if (
		yearText === undefined ||
		monthText === undefined ||
		dayText === undefined
	) {
		return undefined;
	}

	const year = Number.parseInt(yearText, 10);
	const month = Number.parseInt(monthText, 10);
	const day = Number.parseInt(dayText, 10);
	const parsed = new Date();
	parsed.setHours(0, 0, 0, 0);
	parsed.setFullYear(year, month - 1, day);
	if (
		parsed.getFullYear() !== year ||
		parsed.getMonth() !== month - 1 ||
		parsed.getDate() !== day
	) {
		return undefined;
	}

	return formatLocalDate(parsed);
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
		const fileDate = parseDailyLogDate(fileName);
		return fileDate !== undefined && fileDate < cutoffDate;
	});
}

function removeExpiredLogFiles(logDir: string, now = new Date()): void {
	const entries = fs.readdirSync(logDir, { withFileTypes: true });
	const fileNames = entries
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name);

	for (const fileName of filterExpiredLogFiles(fileNames, now)) {
		fs.unlinkSync(path.join(logDir, fileName));
	}
}

function millisecondsUntilNextLocalMidnight(now: Date): number {
	const nextMidnight = new Date(now.getTime());
	nextMidnight.setHours(24, 0, 0, 0);
	return Math.max(nextMidnight.getTime() - now.getTime(), 1);
}

function runRetention(logDir: string): Effect.Effect<void> {
	return Effect.try({
		try: () => {
			removeExpiredLogFiles(logDir);
		},
		catch: (cause) => cause,
	}).pipe(
		Effect.catch((cause) =>
			Effect.logWarning(`Failed to prune old oagent logs in ${logDir}`, cause),
		),
	);
}

function createDailyMaintenance(logDir: string): Effect.Effect<never> {
	return Effect.gen(function* () {
		while (true) {
			yield* Effect.sleep(millisecondsUntilNextLocalMidnight(new Date()));
			yield* runRetention(logDir);
		}
	});
}

function createJsonLogger(writeLine: (line: string, date: Date) => void) {
	return Logger.make((options) => {
		const line = Logger.formatJson.log(options);
		writeLine(line, options.date);
	});
}

function createSingleFileLogger(logFile: string): LoggerSetup {
	const resolvedPath = path.resolve(logFile);
	fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
	const logger = createJsonLogger((line) => {
		fs.appendFileSync(resolvedPath, `${line}\n`);
	});
	return {
		layer: Logger.layer([logger]),
		maintenance: Effect.void,
	};
}

function createDailyDirectoryLogger(logDir: string): LoggerSetup {
	const resolvedDir = path.resolve(logDir);
	fs.mkdirSync(resolvedDir, { recursive: true });
	removeExpiredLogFiles(resolvedDir);
	const logger = createJsonLogger((line, date) => {
		const logFile = path.join(resolvedDir, getDailyLogFileName(date));
		fs.appendFileSync(logFile, `${line}\n`);
	});
	return {
		layer: Logger.layer([logger]),
		maintenance: createDailyMaintenance(resolvedDir),
	};
}

export function createLoggerSetup(params: {
	logFile: string | undefined;
	logDir: string | undefined;
}): Effect.Effect<LoggerSetup, Error> {
	return Effect.try({
		try: () => {
			if (params.logFile !== undefined) {
				return createSingleFileLogger(params.logFile);
			}
			if (params.logDir !== undefined) {
				return createDailyDirectoryLogger(params.logDir);
			}
			return {
				layer: Logger.layer([Logger.consolePretty()]),
				maintenance: Effect.void,
			};
		},
		catch: (cause) =>
			new Error(
				`Failed to configure logging: ${cause instanceof Error ? cause.message : String(cause)}`,
			),
	});
}
