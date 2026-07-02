#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packageJsonPath = new URL('../package.json', import.meta.url);
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

function getTarget() {
	if (process.platform === 'darwin' && process.arch === 'arm64') {
		return 'darwin-arm64';
	}

	if (process.platform === 'darwin' && process.arch === 'x64') {
		return 'darwin-x64';
	}

	if (process.platform === 'linux' && process.arch === 'x64') {
		return 'linux-x64';
	}

	if (process.platform === 'linux' && process.arch === 'arm64') {
		return 'linux-arm64';
	}

	if (process.platform === 'win32') {
		console.error('oagent does not support Windows. Use macOS or Linux.');
		process.exit(1);
	}

	console.error(
		`Unsupported platform for oagent: ${process.platform}-${process.arch}`,
	);
	process.exit(1);
}

function getCacheBaseDir() {
	if (process.env.OAGENT_CACHE_DIR) {
		return process.env.OAGENT_CACHE_DIR;
	}

	return path.join(os.homedir(), '.cache', 'oagent');
}

function removeIfExists(filePath) {
	try {
		fs.rmSync(filePath, { recursive: true, force: true });
	} catch {
		return;
	}
}

async function ensureBinary(target) {
	const cacheDir = path.join(getCacheBaseDir(), version);
	const finalPath = path.join(cacheDir, 'oagent');
	if (fs.existsSync(finalPath)) {
		return finalPath;
	}

	fs.mkdirSync(cacheDir, { recursive: true });
	const downloadUrl = `https://github.com/fdarian/oagent/releases/download/oagent%40${version}/oagent-${target}.tar.gz`;
	const tmpArchive = path.join(
		cacheDir,
		`oagent-${target}.tar.gz.tmp-${process.pid}`,
	);
	const extractDir = path.join(cacheDir, `extract-${target}-${process.pid}`);
	const tempBinaryPath = path.join(cacheDir, `oagent.tmp-${process.pid}`);

	try {
		const response = await fetch(downloadUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to download ${downloadUrl}: HTTP ${response.status} ${response.statusText}`,
			);
		}

		const arrayBuffer = await response.arrayBuffer();
		fs.writeFileSync(tmpArchive, Buffer.from(arrayBuffer));
		fs.mkdirSync(extractDir, { recursive: true });
		execFileSync('tar', ['-xzf', tmpArchive, '-C', extractDir], {
			stdio: 'inherit',
		});
		const extractedBinary = path.join(extractDir, 'oagent');
		if (!fs.existsSync(extractedBinary)) {
			throw new Error(
				`Downloaded archive did not contain oagent: ${downloadUrl}`,
			);
		}

		fs.renameSync(extractedBinary, tempBinaryPath);
		fs.chmodSync(tempBinaryPath, 0o755);
		fs.renameSync(tempBinaryPath, finalPath);
		return finalPath;
	} catch (error) {
		removeIfExists(tmpArchive);
		removeIfExists(extractDir);
		removeIfExists(tempBinaryPath);
		throw error;
	} finally {
		removeIfExists(tmpArchive);
		removeIfExists(extractDir);
	}
}

function forwardSignal(child, signal) {
	if (!child.killed) {
		child.kill(signal);
	}
}

async function main() {
	const binaryOverride = process.env.OAGENT_BINARY;
	const binaryPath = binaryOverride
		? binaryOverride
		: await ensureBinary(getTarget());
	const child = spawn(binaryPath, process.argv.slice(2), { stdio: 'inherit' });

	process.on('SIGINT', () => {
		forwardSignal(child, 'SIGINT');
	});

	process.on('SIGTERM', () => {
		forwardSignal(child, 'SIGTERM');
	});

	child.on('exit', (code, signal) => {
		if (signal) {
			const signalNumber = os.constants.signals[signal];
			if (typeof signalNumber !== 'number') {
				throw new Error(`Unsupported signal exit: ${signal}`);
			}

			process.exit(128 + signalNumber);
		}

		if (typeof code !== 'number') {
			throw new Error('oagent child exited without code or signal');
		}

		process.exit(code);
	});

	child.on('error', (error) => {
		throw error;
	});
}

await main();
