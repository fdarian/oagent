import { Context, Effect, Layer, Schema } from 'effect';
import type { AcpAgent, AcpSessionError, AcpTurnFailed } from './acp-agent.ts';
import type { CodexAuthError } from './codex.ts';
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

export class HarnessModelError extends Schema.TaggedError<HarnessModelError>()(
	'HarnessModelError',
	{
		backend: Schema.String,
		message: Schema.String,
	},
) {}

export type HarnessError = AcpSessionError | AcpTurnFailed | CodexAuthError;

export type HarnessCheckResult =
	| {
			backend: Backend;
			ok: true;
			agentName?: string;
			agentVersion?: string;
	  }
	| {
			backend: Backend;
			ok: false;
			message: string;
	  };

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
	authStatus: () => Effect.Effect<HarnessAuthStatus, HarnessError, never>;
	login: () => Effect.Effect<HarnessLoginResult, HarnessError, never>;
	cancelLogin: () => Effect.Effect<
		HarnessCancelLoginResult,
		HarnessError,
		never
	>;
	logout: () => Effect.Effect<HarnessAuthStatus, HarnessError, never>;
};

export type Harness = {
	backend: Backend;
	runTurn: AcpAgent['Service']['runTurn'];
	listModels: () => Effect.Effect<
		ReadonlyArray<ModelEntry>,
		HarnessError,
		never
	>;
	listModelEfforts: (
		model: string,
	) => Effect.Effect<ReadonlyArray<ModelEffort>, HarnessError, never>;
	resolveBinary: () => string | undefined;
	version: () => Effect.Effect<string | undefined, HarnessError, never>;
	invalidate: () => Effect.Effect<void, never, never>;
	check: () => Effect.Effect<HarnessCheckResult, never, never>;
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
			const byBackend: Record<Backend, Harness> = {
				opencode,
				cursor,
				grok,
				codex,
			};
			const all: ReadonlyArray<Harness> = [
				byBackend.opencode,
				byBackend.cursor,
				byBackend.grok,
				byBackend.codex,
			];

			const get = (backend: Backend): Harness => byBackend[backend];

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
