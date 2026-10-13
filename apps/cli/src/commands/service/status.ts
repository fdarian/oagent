import os from 'node:os';
import { styleText } from 'node:util';
import { Effect } from 'effect';
import { Command } from 'effect/cli';
import {
	loadServiceStatus,
	type ServiceStatus,
} from '#/lib/service/lifecycle.ts';
import { writeLines } from './shared.ts';

type Row = { label: string; value: string };

function tildify(filePath: string): string {
	const home = os.homedir();
	return filePath.startsWith(`${home}/`)
		? `~${filePath.slice(home.length)}`
		: filePath;
}

function hint(action: string, commandText: string): string {
	return `${styleText('dim', `→ ${action} with`)} ${styleText('cyan', commandText)}`;
}

function check(value: boolean): string {
	return value ? styleText('green', '✓') : styleText('red', '✗');
}

// Labels are padded before styling so ANSI codes don't skew the alignment.
function formatSection(rows: ReadonlyArray<Row>): ReadonlyArray<string> {
	const width = Math.max(...rows.map((row) => row.label.length)) + 2;
	return rows.map((row) => {
		const label = styleText('bold', row.label.padEnd(width));
		return `${label}${row.value}`;
	});
}

function statusValue(status: ServiceStatus): string {
	if (status.pid === undefined) {
		return `${styleText('dim', '○ stopped')} ${hint('start', 'oagent service start')}`;
	}
	const pid = styleText('dim', `(pid ${status.pid})`);
	switch (status.mode) {
		case 'service':
			return `${styleText('green', '● running')} ${pid}`;
		case 'on-demand':
			return `${styleText('green', '● running on demand')} ${pid} ${hint('keep running', 'oagent service start')}`;
		case 'not-responding':
			return `${styleText('yellow', '● not responding')} ${pid} ${hint('restart', 'oagent service restart')}`;
		case undefined:
			return `${styleText('green', '● running')} ${pid}`;
	}
}

function serverRows(status: ServiceStatus): ReadonlyArray<Row> {
	const rows: Array<Row> = [{ label: 'Status', value: statusValue(status) }];
	if (status.runningPort !== undefined) {
		rows.push({
			label: 'URL',
			value: styleText('cyan', `http://localhost:${status.runningPort}`),
		});
	}
	if (status.runningBinaryPath !== undefined) {
		rows.push({ label: 'Binary', value: tildify(status.runningBinaryPath) });
		if (status.installed && status.binaryPath !== status.runningBinaryPath) {
			rows.push({
				label: '',
				value: `${styleText('yellow', `⚠ login item uses ${tildify(status.binaryPath)}`)} ${hint('restart', 'oagent service restart')}`,
			});
		}
	}
	return rows;
}

function loginItemRows(status: ServiceStatus): ReadonlyArray<Row> {
	const plist = {
		label: 'Plist',
		value: styleText('dim', tildify(status.paths.plistPath)),
	};
	if (!status.installed) {
		return [
			{
				label: 'Installed',
				value: `${check(false)} ${hint('install', 'oagent service install')}`,
			},
			plist,
		];
	}
	return [
		{ label: 'Installed', value: check(true) },
		{ label: 'Run at login', value: check(status.runAtLoad) },
		{ label: 'Loaded', value: check(status.loaded) },
		plist,
	];
}

function runStatus() {
	return Effect.gen(function* () {
		const status = yield* loadServiceStatus();
		writeLines([
			...formatSection(serverRows(status)),
			'',
			styleText('bold', 'Login item'),
			...formatSection(loginItemRows(status)),
		]);
	});
}

export const status = Command.make('status', {}, () => runStatus()).pipe(
	Command.withDescription('Show login item and server status'),
);
