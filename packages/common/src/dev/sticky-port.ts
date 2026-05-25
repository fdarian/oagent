import { Effect } from 'effect';
import * as S from 'effect/Schema';
import getPort from 'get-port';
import { type DevSession, DevSessionFile } from '../dev-sessions.ts';

const StickyPortFile = DevSessionFile.make(
	S.Struct({
		port: S.Number,
	}),
);

export const getStickyPort = (session: DevSession) =>
	Effect.gen(function* () {
		const file = yield* StickyPortFile.get(session);
		const preferred = file?.port;

		const port = yield* Effect.promise(async () =>
			getPort({
				port: preferred !== undefined ? [preferred] : undefined,
			}),
		);

		yield* StickyPortFile.set(session, { port });

		return port;
	});
