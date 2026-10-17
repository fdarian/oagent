import { type Effect, Schema } from 'effect';
import type {
	AcpAgent,
	AcpForkNotSupportedError,
	AcpSessionError,
	AcpTurnFailed,
} from './acp-agent.ts';

export const BACKENDS = [
	'opencode',
	'cursor',
	'grok',
	'codex',
	'claude',
	'pi',
] as const;

export type Backend = (typeof BACKENDS)[number];

export function isBackend(value: string): value is Backend {
	return (BACKENDS as ReadonlyArray<string>).includes(value);
}

/** A builtin backend, a saved custom harness id, or the reserved inline id. */
export type HarnessId = string;

export const INLINE_ACP_HARNESS_ID = 'acp';

/** The launch definition an inline (`--acp`) session stores on its row. */
export type AcpCommand = {
	readonly binary: string;
	readonly args: ReadonlyArray<string>;
};

/**
 * The `model` string `Jobs` expects for a session on `backend`. Inline sessions
 * take the adapter's bare model id because `acp` is not a model prefix.
 */
export function sessionModelInput(backend: HarnessId, modelId: string): string {
	return backend === INLINE_ACP_HARNESS_ID ? modelId : `${backend}:${modelId}`;
}

export const BUILTIN_HARNESS_NAMES: Record<Backend, string> = {
	opencode: 'OpenCode',
	cursor: 'Cursor',
	grok: 'Grok',
	codex: 'Codex',
	claude: 'Claude',
	pi: 'Pi',
};

export const CUSTOM_HARNESS_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** Syntactic slug check only; whether the id is taken is the registry's call. */
export function isCustomHarnessIdFormat(value: string): boolean {
	return CUSTOM_HARNESS_ID_PATTERN.test(value);
}

export function isReservedHarnessId(value: string): boolean {
	return isBackend(value) || value === INLINE_ACP_HARNESS_ID;
}

export class UnknownHarness extends Schema.TaggedError<UnknownHarness>()(
	'UnknownHarness',
	{
		harnessId: Schema.String,
	},
) {
	override get message() {
		return `Harness "${this.harnessId}" no longer exists or was never defined.`;
	}
}

export type ModelEntry = { id: string; label?: string };

export type AgentTargetEntry = {
	id: string;
	label: string;
	description?: string;
};

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

export class HarnessAuthError extends Schema.TaggedError<HarnessAuthError>()(
	'HarnessAuthError',
	{
		operation: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		return this.cause instanceof Error
			? this.cause.message
			: String(this.cause);
	}
}

export class HarnessSteerError extends Schema.TaggedError<HarnessSteerError>()(
	'HarnessSteerError',
	{
		code: Schema.Literals([
			'NOT_RUNNING',
			'UNSUPPORTED_VERSION',
			'VERSION_CHECK_FAILED',
			'DELIVERY_FAILED',
		]),
		message: Schema.String,
		cause: Schema.Defect(),
	},
) {}

export type HarnessError =
	| AcpForkNotSupportedError
	| AcpSessionError
	| AcpTurnFailed
	| HarnessAuthError
	| HarnessSteerError;

export type HarnessCheckResult =
	| {
			backend: HarnessId;
			ok: true;
			agentName?: string;
			agentVersion?: string;
	  }
	| {
			backend: HarnessId;
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

export type HarnessSteerResult = {
	messageId: string;
	text: string;
};

export type HarnessSteer = (input: {
	sessionId: string;
	text: string;
}) => Effect.Effect<HarnessSteerResult, HarnessSteerError, never>;

export type HarnessForkSession = (input: {
	sessionId: string;
	cwd: string;
}) => Effect.Effect<
	{ sessionId: string },
	AcpForkNotSupportedError | AcpSessionError,
	never
>;

export type HarnessForkSessionBefore = (input: {
	sessionId: string;
	cwd: string;
	before: string;
}) => Effect.Effect<{ sessionId: string }, Error, never>;

export type Harness = {
	backend: HarnessId;
	supportsModelSwitch: boolean;
	runTurn: AcpAgent['Service']['runTurn'];
	listModels: () => Effect.Effect<
		ReadonlyArray<ModelEntry>,
		HarnessError,
		never
	>;
	listModelEfforts: (
		model: string,
	) => Effect.Effect<ReadonlyArray<ModelEffort>, HarnessError, never>;
	listAgentTargets: () => Effect.Effect<
		ReadonlyArray<AgentTargetEntry>,
		HarnessError,
		never
	>;
	resolveBinary: () => string | undefined;
	version: () => Effect.Effect<string | undefined, HarnessError, never>;
	invalidate: () => Effect.Effect<void, never, never>;
	check: () => Effect.Effect<HarnessCheckResult, never, never>;
	auth?: HarnessAuth;
	steer?: HarnessSteer;
	forkSession?: HarnessForkSession;
	forkSessionBefore?: HarnessForkSessionBefore;
	getLatestMessageId?: (
		sessionId: string,
	) => Effect.Effect<string, Error, never>;
	getFirstMessageAfter?: (input: {
		sessionId: string;
		messageId: string;
	}) => Effect.Effect<string, Error, never>;
};
