import fs from 'node:fs';
import { defineConfig } from 'vitest/config';

/** Bun embeds SQL via `import ... with { type: 'text' }`; Vite needs an equivalent loader. */
const sqlTextPlugin = () => ({
	name: 'sql-text-import',
	load(id: string) {
		if (!id.endsWith('.sql')) return;
		return `export default ${JSON.stringify(fs.readFileSync(id, 'utf-8'))}`;
	},
});

export default defineConfig({
	plugins: [sqlTextPlugin()],
	test: {
		include: ['test/**/*.test.ts'],
	},
});
