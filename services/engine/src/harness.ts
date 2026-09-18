import { Context, Effect, Layer, Schema } from 'effect';
import type { AcpAgent, AcpAgentConfig } from './acp-agent.ts';
import { Codex } from './codex.ts';
import { Cursor } from './cursor.ts';
import { Grok } from './grok.ts';
import { OpenCode } from './opencode.ts';

export type Backend = 'opencode' | 'cursor' | 'grok' | 'codex';

export type ModelEntry = { id: string; label?: string };

export type ModelEffort = {
	value: string;
	label: string;
};

export class ModelCatalogError extends Schema.TaggedError<ModelCatalogError>()(
	'ModelCatalogError',
	{
		backend: Schema.String,
		message: Schema.String,
	},
) {}

export type HarnessAuthStatus =
	| {
			backend: Backend;
			status: 'logged_in';
			method?: string;
			account?: string;
	  }
	| {
			backend: Backend;
			status: 'logged_out' | 'pending' | 'unsupported';
	  };

export type HarnessLoginResult =
	| {
			backend: Backend;
			status: 'pending';
			verificationUrl: string;
			userCode: string;
	  }
	| {
			backend: Backend;
			status: 'unsupported';
	  };

export type HarnessCancelLoginResult = {
	backend: Backend;
	cancelled: boolean;
};

export type HarnessAuth = {
	authStatus: () => Effect.Effect<HarnessAuthStatus, unknown, never>;
	login: () => Effect.Effect<HarnessLoginResult, unknown, never>;
	cancelLogin: () => Effect.Effect<HarnessCancelLoginResult, unknown, never>;
	logout: () => Effect.Effect<HarnessAuthStatus, unknown, never>;
};

export type Harness = {
	backend: Backend;
	runTurn: AcpAgent['Service']['runTurn'];
	listModels: () => Effect.Effect<ReadonlyArray<ModelEntry>, unknown, never>;
	listModelEfforts: (
		model: string,
	) => Effect.Effect<ReadonlyArray<ModelEffort>, unknown, never>;
	resolveBinary: () => string | undefined;
	version: () => Effect.Effect<string | undefined, unknown, never>;
	invalidate: () => Effect.Effect<void, never, never>;
	createConfig: () => AcpAgentConfig;
	auth?: HarnessAuth;
};

export class HarnessRegistry extends Context.Service<HarnessRegistry>()(
	'oagent/HarnessRegistry',
	{
		make: Effect.gen(function* () {
			const opencode = yield* OpenCode;
			const cursor = yield* Cursor;
			const grok = yield* Grok;
			const codex = yield* Codex;
			const all: ReadonlyArray<Harness> = [opencode, cursor, grok, codex];
			const byBackend: ReadonlyMap<Backend, Harness> = new Map(
				all.map((harness) => [harness.backend, harness] as const),
			);

			const get = (backend: Backend): Harness => {
				const harness = byBackend.get(backend);
				if (harness === undefined) {
					throw new Error(`No harness registered for ${backend}`);
				}
				return harness;
			};

			return { all, get };
		}),
	},
) {
	static readonly layer = Layer.effect(
		HarnessRegistry,
		HarnessRegistry.make,
	).pipe(
		Layer.provide(OpenCode.layer),
		Layer.provide(Cursor.layer),
		Layer.provide(Grok.layer),
		Layer.provide(Codex.layer),
	);
}
