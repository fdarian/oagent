Bun.build({
  entrypoints: ['./src/index.ts'],
  minify: true,
  bytecode: true,
  compile: { outfile: 'dist/oagent' },
});
