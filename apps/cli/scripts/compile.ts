const entrypoints = [
	'./src/index.ts',
	'.gen/web-ui.gen.ts',
	'../../services/engine/.gen/migrations.gen.ts',
];

export async function compileBinary(options: {
	outfile: string;
	target?: string;
	bytecode?: boolean;
}): Promise<void> {
	const compile = options.target
		? { outfile: options.outfile, target: options.target }
		: { outfile: options.outfile };

	const result = await Bun.build({
		entrypoints: entrypoints,
		target: 'bun',
		minify: true,
		bytecode: options.bytecode ?? false,
		compile: compile,
	});

	if (!result.success) {
		throw new Error(result.logs.map((log) => log.message).join('\n'));
	}
}
