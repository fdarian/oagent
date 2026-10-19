import { Effect, Schema } from 'effect';
import {
	BACKENDS,
	isBackend,
	isCustomHarnessIdFormat,
	isReservedHarnessId,
} from './harness.ts';

export class ModelResolutionError extends Schema.TaggedError<ModelResolutionError>()(
	'ModelResolutionError',
	{
		code: Schema.Literals([
			'MISSING',
			'INVALID_FORMAT',
			'UNKNOWN_BACKEND',
			'UNKNOWN_ALIAS',
		]),
		message: Schema.String,
	},
) {}

export function parseModelInput(model: string) {
	return Effect.gen(function* () {
		const hash = model.lastIndexOf('#');
		const suffixEffort = hash === -1 ? undefined : model.slice(hash + 1);
		if (suffixEffort === '')
			return yield* new ModelResolutionError({
				code: 'INVALID_FORMAT',
				message: `Model "${model}" has an empty reasoning-effort suffix.`,
			});
		const name = hash === -1 ? model : model.slice(0, hash);
		const colon = name.indexOf(':');
		if (colon === -1) return { name, suffixEffort, explicit: undefined };
		const backend = name.slice(0, colon);
		// Whether a slug-shaped prefix names a saved harness is `Jobs`' call.
		if (
			!isBackend(backend) &&
			(isReservedHarnessId(backend) || !isCustomHarnessIdFormat(backend))
		)
			return yield* new ModelResolutionError({
				code: 'UNKNOWN_BACKEND',
				message: `Unknown backend "${backend}". Valid backends: ${BACKENDS.join(', ')}, or a saved custom harness id.`,
			});
		return {
			name,
			suffixEffort,
			explicit: { backend, modelId: name.slice(colon + 1) },
		};
	});
}
