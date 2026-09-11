import { Flag } from 'effect/unstable/cli';

export function writeLines(lines: ReadonlyArray<string>): void {
	process.stdout.write(`${lines.join('\n')}\n`);
}

export const portOption = Flag.Int('port').pipe(
	Flag.withDefault(17_777),
	Flag.withDescription('Port to run the background service on'),
);
