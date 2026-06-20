import { Schema } from 'effect';

/** Tagged error for the macOS launchd service layer. */
export class ServiceError extends Schema.TaggedError<ServiceError>()(
	'ServiceError',
	{
		message: Schema.String,
	},
) {}
