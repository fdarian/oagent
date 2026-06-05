import { Effect, Layer } from 'effect';
import { Cursor } from '../../src/cursor.ts';
import { Grok } from '../../src/grok.ts';
import { Jobs } from '../../src/jobs.ts';
import type { OpenCode } from '../../src/opencode.ts';
import { testDbLayer } from './db.ts';

const unexpected = (name: string) =>
	Effect.dieMessage(`${name} backend must not run in Jobs integration tests`);

const stubCursorLayer = Layer.succeed(Cursor, {
	_tag: 'oagent/Cursor',
	runTurn: () => unexpected('cursor'),
	listModels: () => Effect.succeed([]),
} as Cursor);

const stubGrokLayer = Layer.succeed(Grok, {
	_tag: 'oagent/Grok',
	runTurn: () => unexpected('grok'),
	listModels: () => Effect.succeed([]),
} as Grok);

/** `Jobs` with isolated DB and injected `OpenCode`; cursor/grok are inert stubs. Requires `Effect.scoped`. */
export const jobsTestLayer = (openCodeLayer: Layer.Layer<OpenCode>) =>
	Jobs.DefaultWithoutDependencies.pipe(
		Layer.provide(openCodeLayer),
		Layer.provide(stubCursorLayer),
		Layer.provide(stubGrokLayer),
		Layer.provide(testDbLayer),
	);
