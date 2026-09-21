import { execFileSync } from 'node:child_process';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

function readBuildCommit(): string {
	const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
		cwd: path.resolve(__dirname, '../..'),
		encoding: 'utf8',
	}).trim();

	if (commit.length === 0) {
		throw new Error('Git returned an empty build commit');
	}

	return commit;
}

const buildCommit = readBuildCommit();

export default defineConfig({
	plugins: [react(), tailwindcss()],
	define: {
		'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(buildCommit),
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
	server: {
		proxy: {
			'/rpc': {
				target: process.env.ENGINE_URL ?? 'http://localhost:17777',
				changeOrigin: true,
			},
			'/jobs': {
				target: process.env.ENGINE_URL ?? 'http://localhost:17777',
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: 'dist',
	},
});
