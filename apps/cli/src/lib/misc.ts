export type Version = string;

/** Unwraps nested `.cause` chains to surface the deepest meaningful error message. */
export function errorMessage(cause: unknown): string {
	if (!(cause instanceof Error)) {
		return String(cause);
	}
	if (cause.cause !== undefined) {
		return errorMessage(cause.cause);
	}
	return cause.message;
}
