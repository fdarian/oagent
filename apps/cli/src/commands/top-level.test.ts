import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

async function runCli(args: ReadonlyArray<string>) {
	const child = Bun.spawn(
		[
			process.execPath,
			fileURLToPath(new URL('../index.ts', import.meta.url)),
			...args,
		],
		{ stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
	);
	const outputs = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
	]);
	return { stdout: outputs[0], exitCode: outputs[1] };
}

const listingFlags: ReadonlyArray<[string, ReadonlyArray<string>]> = [
	['models', ['--backend', '--format', '--engine-url']],
	['agents', ['--format', '--engine-url']],
	['aliases', ['--format', '--engine-url']],
];

describe('top-level listing command help', () => {
	for (const entry of listingFlags) {
		test(entry[0], async () => {
			const result = await runCli([entry[0], '--help']);
			expect(result.exitCode).toBe(0);
			for (const flag of entry[1]) {
				expect(result.stdout).toContain(flag);
			}
		});
	}
});
