import fs from 'node:fs';
import { Effect } from 'effect';
import { ServiceError } from '#/lib/service/errors.ts';
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
	pathEnv: string;
	homeDirectory: string;
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
		'\t\t<string>service</string>',
		'\t\t<string>start</string>',
		'\t\t<string>--port</string>',
		`\t\t<string>${String(params.port)}</string>`,
		'\t</array>',
		'\t<key>RunAtLoad</key>',
		'\t<true/>',
		'\t<key>KeepAlive</key>',
		'\t<false/>',
		'\t<key>StandardOutPath</key>',
		'\t<string>/dev/null</string>',
		'\t<key>StandardErrorPath</key>',
		'\t<string>/dev/null</string>',
		'\t<key>WorkingDirectory</key>',
		`\t<string>${escapeXml(params.homeDirectory)}</string>`,
		// launchd starts agents with a minimal PATH; bake in the caller's PATH so
		// the engine can spawn its ACP backends (opencode, codex-acp, …).
		'\t<key>EnvironmentVariables</key>',
		'\t<dict>',
		'\t\t<key>PATH</key>',
		`\t\t<string>${escapeXml(params.pathEnv)}</string>`,
		'\t\t<key>OAGENT_HOME_DIR</key>',
		`\t\t<string>${escapeXml(params.homeDirectory)}</string>`,
		'\t</dict>',
		'</dict>',
		'</plist>',
		'',
	].join('\n');
}

export function writePlistFile(
	plistPath: string,
	plistXml: string,
): Effect.Effect<void, ServiceError> {
	return Effect.try({
		try: () => {
			fs.writeFileSync(plistPath, plistXml, 'utf8');
		},
		catch: (cause) =>
			new ServiceError({
				message: `Failed to write LaunchAgent plist: ${errorMessage(cause)}`,
			}),
	});
}

export type ServiceConfiguration = {
	binaryPath: string;
	port: number;
	runAtLoad: boolean;
};

function unescapeXml(value: string): string {
	return value
		.replaceAll('&apos;', "'")
		.replaceAll('&quot;', '"')
		.replaceAll('&gt;', '>')
		.replaceAll('&lt;', '<')
		.replaceAll('&amp;', '&');
}

function parseServiceConfiguration(
	plistPath: string,
	plist: string,
): ServiceConfiguration {
	const binaryMatch = plist.match(
		/<key>ProgramArguments<\/key>\s*<array>\s*<string>([\s\S]*?)<\/string>/,
	);
	if (binaryMatch === null || binaryMatch[1] === undefined) {
		throw new ServiceError({
			message: `Unable to parse binary path from ${plistPath}`,
		});
	}

	const portMatch = plist.match(
		/<string>--port<\/string>\s*<string>(\d+)<\/string>/,
	);
	if (portMatch === null || portMatch[1] === undefined) {
		throw new ServiceError({
			message: `Unable to parse configured port from ${plistPath}`,
		});
	}

	const runAtLoadMatch = plist.match(
		/<key>RunAtLoad<\/key>\s*(<true\s*\/>|<false\s*\/>)/,
	);
	if (runAtLoadMatch === null || runAtLoadMatch[1] === undefined) {
		throw new ServiceError({
			message: `Unable to parse login launch setting from ${plistPath}`,
		});
	}

	return {
		binaryPath: unescapeXml(binaryMatch[1]),
		port: Number.parseInt(portMatch[1], 10),
		runAtLoad: runAtLoadMatch[1].startsWith('<true'),
	};
}

export function loadServiceConfiguration(
	plistPath: string,
): Effect.Effect<ServiceConfiguration, ServiceError> {
	return Effect.try({
		try: () => {
			const plist = fs.readFileSync(plistPath, 'utf8');
			return parseServiceConfiguration(plistPath, plist);
		},
		catch: (cause) =>
			cause instanceof ServiceError
				? cause
				: new ServiceError({
						message: `Unable to parse service configuration from ${plistPath}: ${errorMessage(cause)}`,
					}),
	});
}

export function loadConfiguredPort(
	plistPath: string,
): Effect.Effect<number, ServiceError> {
	return Effect.try({
		try: () => {
			const plist = fs.readFileSync(plistPath, 'utf8');
			const match = plist.match(
				/<string>--port<\/string>\s*<string>(\d+)<\/string>/,
			);
			if (match === null || match[1] === undefined) {
				throw new ServiceError({
					message: `Unable to parse configured port from ${plistPath}`,
				});
			}
			return Number.parseInt(match[1], 10);
		},
		catch: (cause) =>
			cause instanceof ServiceError
				? cause
				: new ServiceError({
						message: `Unable to parse configured port from ${plistPath}: ${errorMessage(cause)}`,
					}),
	});
}

export function removePlistFile(
	plistPath: string,
): Effect.Effect<void, ServiceError> {
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
			new ServiceError({
				message: `Failed to remove plist file: ${errorMessage(cause)}`,
			}),
	});
}
