import { prepareAssets } from './prepare-assets';

await prepareAssets();

// 5. Build standalone binary
const result = await Bun.build({
	entrypoints: [
		'./src/index.ts',
		'.gen/web-ui.gen.ts',
		'../../services/engine/.gen/migrations.gen.ts',
	],
	minify: true,
	bytecode: true,
	compile: { outfile: 'dist/oagent' },
	target: 'bun',
});

if (!result.success) {
	console.error('Bun build failed:');
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

console.log('Built dist/oagent');
