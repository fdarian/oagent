import { type Effect, Schema } from 'effect';
import type {
	AcpAgent,
	AcpForkNotSupportedError,
	AcpSessionError,
	AcpTurnFailed,
} from './acp-agent.ts';

export type Backend = 'opencode' | 'cursor' | 'grok' | 'codex' | 'claude';

export function isBackend(value: string): value is Backend {
	return (
		value === 'opencode' ||
		value === 'cursor' ||
		value === 'grok' ||
		value === 'codex' ||
		value === 'claude'
	);
}

export function parseBackend(value: string): Backend {
	if (isBackend(value)) return value;
	throw new Error(`Invalid persisted job backend: ${value}`);
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
			backend: 'opencode';
			ok: true;
			running: boolean;
			url?: string;
			version?: string;
	  }
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
