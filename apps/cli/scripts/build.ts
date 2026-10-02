import { compileBinary } from './compile';
import { prepareAssets } from './prepare-assets';

await prepareAssets();
await compileBinary({
	outfile: 'dist/oagent',
	production: process.argv.includes('--prod'),
});

console.log('Built dist/oagent');
