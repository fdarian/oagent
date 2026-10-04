import cliPackage from '../package.json' with { type: 'json' };

const entrypoints = [
	'./src/index.ts',
	'.gen/web-ui.gen.ts',
	'../../services/engine/.gen/migrations.gen.ts',
];

export async function compileBinary(options: {
	outfile: string;
	target?: string;
	bytecode?: boolean;
	production: boolean;
}): Promise<void> {
	const version = buildVersion(options.production);
	const compile = options.target
		? { outfile: options.outfile, target: options.target }
		: { outfile: options.outfile };

	const result = await Bun.build({
		entrypoints: entrypoints,
		target: 'bun',
		minify: true,
		define: { OAGENT_BUILD_VERSION: JSON.stringify(version) },
		bytecode: options.bytecode ?? false,
		compile: compile,
	});

	if (!result.success) {
		throw new Error(result.logs.map((log) => log.message).join('\n'));
	}
}

function buildVersion(production: boolean): string {
	if (production) return cliPackage.version;

	const result = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], {
		cwd: import.meta.dir,
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`Failed to resolve build commit: ${result.stderr.toString()}`,
		);
	}
	const commit = result.stdout.toString().trim();
	if (commit.length === 0)
		throw new Error('Git returned an empty build commit');

	return `${cliPackage.version} (${commit})`;
}
