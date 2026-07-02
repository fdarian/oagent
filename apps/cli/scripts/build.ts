import { compileBinary } from './compile';
import { prepareAssets } from './prepare-assets';

await prepareAssets();
await compileBinary({ outfile: 'dist/oagent', bytecode: true });

console.log('Built dist/oagent');
