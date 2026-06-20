import fs from 'node:fs';
import { getOagentBaseDir } from '@oagent/engine';
import { Effect } from 'effect';
import { errorMessage, SERVICE_LABEL } from '#/lib/service/launchctl.ts';

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export function createPlistXml(params: {
	binaryPath: string;
	port: number;
	jsonlLogPath: string;
	stdoutLogPath: string;
	stderrLogPath: string;
	pathEnv: string;
}): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		'<dict>',
		'\t<key>Label</key>',
		`\t<string>${escapeXml(SERVICE_LABEL)}</string>`,
		'\t<key>ProgramArguments</key>',
		'\t<array>',
		`\t\t<string>${escapeXml(params.binaryPath)}</string>`,
		'\t\t<string>serve</string>',
		'\t\t<string>--port</string>',
		`\t\t<string>${String(params.port)}</string>`,
		'\t\t<string>--log-file</string>',
		`\t\t<string>${escapeXml(params.jsonlLogPath)}</string>`,
		'\t</array>',
		'\t<key>RunAtLoad</key>',
		'\t<true/>',
		'\t<key>KeepAlive</key>',
		'\t<true/>',
		'\t<key>StandardOutPath</key>',
		`\t<string>${escapeXml(params.stdoutLogPath)}</string>`,
		'\t<key>StandardErrorPath</key>',
		`\t<string>${escapeXml(params.stderrLogPath)}</string>`,
		'\t<key>WorkingDirectory</key>',
		`\t<string>${escapeXml(getOagentBaseDir())}</string>`,
		// launchd starts agents with a minimal PATH; bake in the caller's PATH so
		// the engine can spawn its ACP backends (opencode, codex-acp, …).
		'\t<key>EnvironmentVariables</key>',
		'\t<dict>',
		'\t\t<key>PATH</key>',
		`\t\t<string>${escapeXml(params.pathEnv)}</string>`,
		'\t</dict>',
		'</dict>',
		'</plist>',
		'',
	].join('\n');
}

export function writePlistFile(
	plistPath: string,
	plistXml: string,
): Effect.Effect<void, Error> {
	return Effect.try({
		try: () => {
			fs.writeFileSync(plistPath, plistXml, 'utf8');
		},
		catch: (cause) =>
			new Error(`Failed to write LaunchAgent plist: ${errorMessage(cause)}`),
	});
}

export function loadConfiguredPort(
	plistPath: string,
): Effect.Effect<number, Error> {
	return Effect.try({
		try: () => {
			const plist = fs.readFileSync(plistPath, 'utf8');
			const match = plist.match(
				/<string>--port<\/string>\s*<string>(\d+)<\/string>/,
			);
			if (match === null) {
				throw new Error(`Unable to parse configured port from ${plistPath}`);
			}
			const portValue = match[1];
			if (portValue === undefined) {
				throw new Error(`Unable to parse configured port from ${plistPath}`);
			}
			return Number.parseInt(portValue, 10);
		},
		catch: (cause) =>
			cause instanceof Error
				? cause
				: new Error(
						`Unable to parse configured port from ${plistPath}: ${errorMessage(cause)}`,
					),
	});
}

export function removePlistFile(plistPath: string): Effect.Effect<void, Error> {
	return Effect.try({
		try: () => {
			try {
				fs.rmSync(plistPath);
			} catch (err) {
				// tolerate missing file — already gone
				if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
					throw err;
				}
			}
		},
		catch: (cause) =>
			new Error(`Failed to remove plist file: ${errorMessage(cause)}`),
	});
}
