import { Options } from '@effect/cli';

export function writeLines(lines: ReadonlyArray<string>): void {
	process.stdout.write(`${lines.join('\n')}\n`);
}

export const portOption = Options.integer('port').pipe(
	Options.withDefault(17_777),
	Options.withDescription('Port to run the background service on'),
);
