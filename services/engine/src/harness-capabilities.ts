import { Effect, Schema } from 'effect';
import type { AcpForkNotSupportedError, AcpSessionError } from './acp-agent.ts';

export type HarnessSteerResult = {
	messageId: string;
	text: string;
};

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
