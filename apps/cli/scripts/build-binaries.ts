import fs from 'node:fs';
import { compileBinary } from './compile';
import { prepareAssets } from './prepare-assets';

const targets = [
	{ bunTarget: 'bun-darwin-arm64', label: 'darwin-arm64' },
	{ bunTarget: 'bun-darwin-x64', label: 'darwin-x64' },
	{ bunTarget: 'bun-linux-x64', label: 'linux-x64' },
	{ bunTarget: 'bun-linux-arm64', label: 'linux-arm64' },
];

function runOrThrow(command: string[], errorPrefix: string): void {
	const result = Bun.spawnSync(command);
	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString();
		const stdout = result.stdout.toString();
		throw new Error(
			`${errorPrefix} (exit ${result.exitCode})\n${stderr.length > 0 ? stderr : stdout}`,
		);
	}
}

// Bun's Linux->darwin `--compile` cross-compilation writes an invalid ("linker-signed")
// ad-hoc signature; Apple Silicon macOS rejects it and SIGKILLs the binary on launch.
// Re-signing ad-hoc after compilation fixes it. `codesign` is used when running on macOS
// (local builds), `rcodesign` when running elsewhere (Linux CI, which cross-compiles).
function signMacBinary(binaryPath: string): void {
	const command =
		process.platform === 'darwin'
			? ['codesign', '--force', '--sign', '-', binaryPath]
			: ['rcodesign', 'sign', binaryPath];
	runOrThrow(command, `code signing failed for '${binaryPath}'`);
}

await prepareAssets();

for (const target of targets) {
	const outDir = `dist/bin/${target.label}`;
	const releaseDir = 'dist/releases';
	fs.mkdirSync(outDir, { recursive: true });
	fs.mkdirSync(releaseDir, { recursive: true });

	// Cross-target bytecode compilation currently fails on Bun, so release builds use minified native binaries without bytecode.
	await compileBinary({
		outfile: `${outDir}/oagent`,
		target: target.bunTarget,
	});

	if (target.label.startsWith('darwin')) signMacBinary(`${outDir}/oagent`);

	runOrThrow(
		[
			'tar',
			'-czf',
			`${releaseDir}/oagent-${target.label}.tar.gz`,
			'-C',
			outDir,
			'oagent',
		],
		`tar failed for target '${target.label}'`,
	);
}
