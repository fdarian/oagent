import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

async function runCli(args: ReadonlyArray<string>) {
	const child = Bun.spawn(
		[
			process.execPath,
			fileURLToPath(new URL('../index.ts', import.meta.url)),
			...args,
		],
		{ stdout: 'pipe', stderr: 'pipe' },
	);
	const outputs = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout: outputs[0], stderr: outputs[1], exitCode: outputs[2] };
}

test('MCP stdio exposes the thin-client flags', async () => {
	const result = await runCli(['mcp', 'stdio', '--help']);
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain('--engine-url');
	expect(result.stdout).toContain('--bare');
});

test('top-level stdio is not a command', async () => {
	const result = await runCli(['stdio']);
	expect(result.exitCode).not.toBe(0);
	expect(`${result.stdout}${result.stderr}`).not.toContain('[sqlite]');
});
