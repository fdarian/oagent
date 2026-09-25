import { Context, Effect, Layer, Redacted, Schema } from 'effect';
import {
	FetchHttpClient,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
} from 'effect/unstable/http';

const SERVICE_COMMAND_TIMEOUT_MS = 15_000;

const SteerResponse = Schema.Struct({
	data: Schema.Struct({
		id: Schema.String,
		sessionID: Schema.String,
		type: Schema.Literals(['user']),
		payload: Schema.Struct({ text: Schema.String }),
		delivery: Schema.Literals(['steer']),
	}),
});

const SessionResponse = Schema.Struct({
	data: Schema.Struct({
		permissions: Schema.optional(
			Schema.Array(
				Schema.Struct({
					action: Schema.String,
					resource: Schema.String,
					effect: Schema.Literals(['allow', 'ask', 'deny']),
				}),
			),
		),
	}),
});

const ActiveSessionsResponse = Schema.Struct({
	data: Schema.Record(
		Schema.String,
		Schema.Struct({ type: Schema.Literals(['running']) }),
	),
});

const ForkResponse = Schema.Struct({
	data: Schema.Struct({ id: Schema.String }),
});

const MessagesResponse = Schema.Struct({
	data: Schema.Array(Schema.Struct({ id: Schema.String })),
	cursor: Schema.optional(
		Schema.Struct({ next: Schema.optional(Schema.NullOr(Schema.String)) }),
	),
});

const ApiSessionResponse = Schema.Struct({
	data: Schema.Struct({
		id: Schema.String,
		agent: Schema.optional(Schema.String),
		model: Schema.optional(
			Schema.Struct({
				id: Schema.String,
				providerID: Schema.String,
				variant: Schema.optional(Schema.String),
			}),
		),
	}),
});
const ServiceInfoResponse = Schema.Struct({ version: Schema.String });

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type OpenCodeSteerResult = {
	messageId: string;
	text: string;
};

export class OpenCodeServiceDiscoveryError extends Schema.TaggedError<OpenCodeServiceDiscoveryError>()(
	'OpenCodeServiceDiscoveryError',
	{
		step: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		const detail =
			this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `OpenCode service discovery failed while ${this.step}: ${detail}. Run \`opencode service start\` and try again.`;
	}
}

export class OpenCodeSteerRequestError extends Schema.TaggedError<OpenCodeSteerRequestError>()(
	'OpenCodeSteerRequestError',
	{
		sessionId: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		const detail =
			this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `Failed to steer OpenCode session "${this.sessionId}": ${detail}`;
	}
}

export class OpenCodeSessionPermissionError extends Schema.TaggedError<OpenCodeSessionPermissionError>()(
	'OpenCodeSessionPermissionError',
	{
		sessionId: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		const detail =
			this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `Could not set permissions for OpenCode session "${this.sessionId}": ${detail}`;
	}
}

export class OpenCodeSessionStatusError extends Schema.TaggedError<OpenCodeSessionStatusError>()(
	'OpenCodeSessionStatusError',
	{
		sessionId: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		const detail =
			this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `Failed to read OpenCode activity for session "${this.sessionId}": ${detail}`;
	}
}

export class OpenCodeSessionRestError extends Schema.TaggedError<OpenCodeSessionRestError>()(
	'OpenCodeSessionRestError',
	{
		operation: Schema.String,
		sessionId: Schema.String,
		cause: Schema.Defect(),
	},
) {
	override get message() {
		const detail =
			this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `OpenCode ${this.operation} failed for session "${this.sessionId}": ${detail}`;
	}
}

function discoveryError(step: string, cause: unknown) {
	return new OpenCodeServiceDiscoveryError({ step, cause });
}

function runServiceCommand(
	binaryPath: string,
	args: ReadonlyArray<string>,
	step: string,
): Effect.Effect<CommandResult, OpenCodeServiceDiscoveryError> {
	const command = Effect.scoped(
		Effect.gen(function* () {
			const process = yield* Effect.acquireRelease(
				Effect.try({
					try: () =>
						Bun.spawn([binaryPath, ...args], {
							stdin: 'ignore',
							stdout: 'pipe',
							stderr: 'pipe',
						}),
					catch: (cause) => discoveryError(step, cause),
				}),
				(child) =>
					Effect.sync(() => {
						if (child.exitCode === null) child.kill();
					}),
			);
			const result = yield* Effect.tryPromise({
				try: () =>
					Promise.all([
						new Response(process.stdout).text(),
						new Response(process.stderr).text(),
						process.exited,
					]),
				catch: (cause) => discoveryError(step, cause),
			});
			return {
				stdout: result[0],
				stderr: result[1],
				exitCode: result[2],
			};
		}),
	);

	return command.pipe(
		Effect.timeout(SERVICE_COMMAND_TIMEOUT_MS),
		Effect.mapError((cause) =>
			cause instanceof OpenCodeServiceDiscoveryError
				? cause
				: discoveryError(step, cause),
		),
	);
}

function commandExitError(
	step: string,
	command: string,
	result: CommandResult,
): OpenCodeServiceDiscoveryError {
	const stderr = result.stderr.trim();
	const detail =
		stderr.length === 0
			? `${command} exited with code ${result.exitCode}`
			: `${command} exited with code ${result.exitCode}: ${stderr}`;
	return discoveryError(step, new Error(detail));
}

export function isOpenCodeServiceStopped(output: string): boolean {
	return output.trim() === 'stopped';
}

export class OpenCodeServiceClient extends Context.Service<OpenCodeServiceClient>()(
	'oagent/OpenCodeServiceClient',
	{
		make: Effect.gen(function* () {
			const httpClient = yield* HttpClient.HttpClient;

			const discover = (
				binaryPath: string,
			): Effect.Effect<
				{ url: string; password: string },
				OpenCodeServiceDiscoveryError
			> =>
				Effect.gen(function* () {
					const statusStep = 'running `opencode service status`';
					const status = yield* runServiceCommand(
						binaryPath,
						['service', 'status'],
						statusStep,
					);
					if (isOpenCodeServiceStopped(status.stdout)) {
						return yield* discoveryError(
							statusStep,
							new Error('OpenCode service is not running'),
						);
					}
					if (status.exitCode !== 0) {
						return yield* commandExitError(
							statusStep,
							'opencode service status',
							status,
						);
					}
					const rawUrl = status.stdout.trim();
					if (rawUrl.length === 0) {
						return yield* discoveryError(
							statusStep,
							new Error('opencode service status returned no service URL'),
						);
					}
					const serviceUrl = yield* Effect.try({
						try: () => new URL(rawUrl),
						catch: (cause) => discoveryError(statusStep, cause),
					});
					if (
						serviceUrl.protocol !== 'http:' &&
						serviceUrl.protocol !== 'https:'
					) {
						return yield* discoveryError(
							statusStep,
							new Error(
								'opencode service status did not return an HTTP service URL',
							),
						);
					}

					const passwordStep = 'running `opencode service get password`';
					const passwordResult = yield* runServiceCommand(
						binaryPath,
						['service', 'get', 'password'],
						passwordStep,
					);
					if (passwordResult.exitCode !== 0) {
						return yield* commandExitError(
							passwordStep,
							'opencode service get password',
							passwordResult,
						);
					}
					const password = passwordResult.stdout.trim();
					if (password.length === 0) {
						return yield* discoveryError(
							passwordStep,
							new Error('opencode service get password returned no password'),
						);
					}

					return { url: serviceUrl.toString(), password };
				});

			const steer = (
				binaryPath: string,
				input: { sessionId: string; text: string },
			): Effect.Effect<
				OpenCodeSteerResult,
				OpenCodeServiceDiscoveryError | OpenCodeSteerRequestError
			> =>
				Effect.gen(function* () {
					const service = yield* discover(binaryPath);
					const url = new URL(
						`/api/session/${encodeURIComponent(input.sessionId)}/prompt`,
						service.url,
					);
					const request = yield* HttpClientRequest.post(url).pipe(
						HttpClientRequest.basicAuth(
							'opencode',
							Redacted.make(service.password),
						),
						HttpClientRequest.bodyJson({
							text: input.text,
							delivery: 'steer',
							// Must stay false: true starts a competing runner and corrupts the ACP-owned turn's tool state.
							resume: false,
						}),
						Effect.mapError(
							(cause) =>
								new OpenCodeSteerRequestError({
									sessionId: input.sessionId,
									cause,
								}),
						),
					);
					const response = yield* httpClient.execute(request).pipe(
						Effect.mapError(
							(cause) =>
								new OpenCodeSteerRequestError({
									sessionId: input.sessionId,
									cause,
								}),
						),
					);
					if (response.status !== 200) {
						return yield* new OpenCodeSteerRequestError({
							sessionId: input.sessionId,
							cause: new Error(
								`OpenCode service returned HTTP ${response.status}`,
							),
						});
					}
					const body = yield* HttpClientResponse.schemaBodyJson(SteerResponse)(
						response,
					).pipe(
						Effect.mapError(
							(cause) =>
								new OpenCodeSteerRequestError({
									sessionId: input.sessionId,
									cause,
								}),
						),
					);
					return {
						messageId: body.data.id,
						text: body.data.payload.text,
					};
				});

			const disableQuestion = (
				binaryPath: string,
				sessionId: string,
			): Effect.Effect<
				void,
				OpenCodeServiceDiscoveryError | OpenCodeSessionPermissionError
			> =>
				Effect.gen(function* () {
					const service = yield* discover(binaryPath);
					const url = new URL(
						`/api/session/${encodeURIComponent(sessionId)}`,
						service.url,
					);
					const permissionError = (cause: unknown) =>
						new OpenCodeSessionPermissionError({ sessionId, cause });
					const request = HttpClientRequest.get(url).pipe(
						HttpClientRequest.basicAuth(
							'opencode',
							Redacted.make(service.password),
						),
					);
					const response = yield* httpClient
						.execute(request)
						.pipe(Effect.mapError(permissionError));
					if (response.status !== 200) {
						return yield* permissionError(
							new Error(`OpenCode service returned HTTP ${response.status}`),
						);
					}
					const session = yield* HttpClientResponse.schemaBodyJson(
						SessionResponse,
					)(response).pipe(Effect.mapError(permissionError));
					const lastQuestionRule = session.data.permissions
						?.filter(
							(rule) => rule.action === 'question' && rule.resource === '*',
						)
						.at(-1);
					if (lastQuestionRule?.effect === 'deny') return;
					const update = yield* HttpClientRequest.patch(url).pipe(
						HttpClientRequest.basicAuth(
							'opencode',
							Redacted.make(service.password),
						),
						HttpClientRequest.bodyJson({
							permissions: [
								...(session.data.permissions === undefined
									? []
									: session.data.permissions),
								{ action: 'question', resource: '*', effect: 'deny' },
							],
						}),
						Effect.mapError(permissionError),
					);
					const updated = yield* httpClient
						.execute(update)
						.pipe(Effect.mapError(permissionError));
					if (updated.status !== 204) {
						return yield* permissionError(
							new Error(`OpenCode service returned HTTP ${updated.status}`),
						);
					}
				});

			const isSessionActive = (
				binaryPath: string,
				sessionId: string,
			): Effect.Effect<
				boolean,
				OpenCodeServiceDiscoveryError | OpenCodeSessionStatusError
			> =>
				Effect.gen(function* () {
					const service = yield* discover(binaryPath);
					const url = new URL('/api/session/active', service.url);
					const request = HttpClientRequest.get(url).pipe(
						HttpClientRequest.basicAuth(
							'opencode',
							Redacted.make(service.password),
						),
					);
					const response = yield* httpClient
						.execute(request)
						.pipe(
							Effect.mapError(
								(cause) => new OpenCodeSessionStatusError({ sessionId, cause }),
							),
						);
					if (response.status !== 200) {
						return yield* new OpenCodeSessionStatusError({
							sessionId,
							cause: new Error(
								`OpenCode service returned HTTP ${response.status}`,
							),
						});
					}
					const body = yield* HttpClientResponse.schemaBodyJson(
						ActiveSessionsResponse,
					)(response).pipe(
						Effect.mapError(
							(cause) => new OpenCodeSessionStatusError({ sessionId, cause }),
						),
					);
					return body.data[sessionId] !== undefined;
				});

			const forkSession = (
				binaryPath: string,
				input: {
					sessionId: string;
					before?: string;
				},
			): Effect.Effect<
				string,
				OpenCodeServiceDiscoveryError | OpenCodeSessionRestError
			> =>
				Effect.gen(function* () {
					const service = yield* discover(binaryPath);
					const url = new URL(
						`/api/session/${encodeURIComponent(input.sessionId)}/fork`,
						service.url,
					);
					const operationError = (cause: unknown) =>
						new OpenCodeSessionRestError({
							operation: 'REST fork',
							sessionId: input.sessionId,
							cause,
						});
					const request = yield* HttpClientRequest.post(url).pipe(
						HttpClientRequest.basicAuth(
							'opencode',
							Redacted.make(service.password),
						),
						HttpClientRequest.bodyJson(
							input.before === undefined ? {} : { before: input.before },
						),
						Effect.mapError(operationError),
					);
					const response = yield* httpClient
						.execute(request)
						.pipe(Effect.mapError(operationError));
					if (response.status !== 200) {
						return yield* operationError(
							new Error(`OpenCode service returned HTTP ${response.status}`),
						);
					}
					const body = yield* HttpClientResponse.schemaBodyJson(ForkResponse)(
						response,
					).pipe(Effect.mapError(operationError));
					return body.data.id;
				});

			const getLatestMessageId = (binaryPath: string, sessionId: string) =>
				Effect.gen(function* () {
					const service = yield* discover(binaryPath);
					const url = new URL(
						`/api/session/${encodeURIComponent(sessionId)}/message?order=desc&limit=1`,
						service.url,
					);
					const operationError = (cause: unknown) =>
						new OpenCodeSessionRestError({
							operation: 'message lookup',
							sessionId,
							cause,
						});
					const request = HttpClientRequest.get(url).pipe(
						HttpClientRequest.basicAuth(
							'opencode',
							Redacted.make(service.password),
						),
					);
					const response = yield* httpClient
						.execute(request)
						.pipe(Effect.mapError(operationError));
					if (response.status !== 200) {
						return yield* operationError(
							new Error(`OpenCode service returned HTTP ${response.status}`),
						);
					}
					const body = yield* HttpClientResponse.schemaBodyJson(
						MessagesResponse,
					)(response).pipe(Effect.mapError(operationError));
					const latest = body.data[0];
					if (latest === undefined) {
						return yield* operationError(new Error('Session has no messages'));
					}
					return latest.id;
				});

			const getFirstMessageAfter = (
				binaryPath: string,
				input: { sessionId: string; messageId: string },
			) =>
				Effect.gen(function* () {
					const service = yield* discover(binaryPath);
					const operationError = (cause: unknown) =>
						new OpenCodeSessionRestError({
							operation: 'message lookup',
							sessionId: input.sessionId,
							cause,
						});
					let cursor: string | undefined;
					let previousWasCheckpoint = false;
					while (true) {
						const url = new URL(
							`/api/session/${encodeURIComponent(input.sessionId)}/message`,
							service.url,
						);
						url.searchParams.set('limit', '100');
						if (cursor === undefined) {
							url.searchParams.set('order', 'asc');
						} else {
							url.searchParams.set('cursor', cursor);
						}
						const request = HttpClientRequest.get(url).pipe(
							HttpClientRequest.basicAuth(
								'opencode',
								Redacted.make(service.password),
							),
						);
						const response = yield* httpClient
							.execute(request)
							.pipe(Effect.mapError(operationError));
						if (response.status !== 200) {
							return yield* operationError(
								new Error(`OpenCode service returned HTTP ${response.status}`),
							);
						}
						const body = yield* HttpClientResponse.schemaBodyJson(
							MessagesResponse,
						)(response).pipe(Effect.mapError(operationError));
						for (const message of body.data) {
							if (previousWasCheckpoint) return message.id;
							previousWasCheckpoint = message.id === input.messageId;
						}
						const next = body.cursor?.next ?? undefined;
						if (next === undefined) {
							return yield* operationError(
								new Error(
									`Message ${input.messageId} has no following message`,
								),
							);
						}
						cursor = next;
					}
				});

			const request = (
				binaryPath: string,
				method: 'GET' | 'POST',
				path: string,
				body?: unknown,
			) =>
				Effect.gen(function* () {
					const service = yield* discover(binaryPath);
					const url = new URL(path, service.url);
					const authenticated = (
						method === 'GET'
							? HttpClientRequest.get(url)
							: HttpClientRequest.post(url)
					).pipe(
						HttpClientRequest.basicAuth(
							'opencode',
							Redacted.make(service.password),
						),
					);
					const req =
						body === undefined
							? authenticated
							: yield* HttpClientRequest.bodyJson(authenticated, body).pipe(
									Effect.mapError(
										(cause) =>
											new OpenCodeSessionRestError({
												operation: path,
												sessionId: path,
												cause,
											}),
									),
								);
					const response = yield* httpClient.execute(req).pipe(
						Effect.mapError(
							(cause) =>
								new OpenCodeSessionRestError({
									operation: path,
									sessionId: path,
									cause,
								}),
						),
					);
					if (response.status < 200 || response.status >= 300)
						return yield* new OpenCodeSessionRestError({
							operation: path,
							sessionId: path,
							cause: new Error(
								`OpenCode service returned HTTP ${response.status}`,
							),
						});
					return response;
				});

			const apiSession = (
				binaryPath: string,
				sessionId: string | undefined,
				cwd: string,
			) =>
				Effect.gen(function* () {
					const response = yield* request(
						binaryPath,
						sessionId === undefined ? 'POST' : 'GET',
						sessionId === undefined
							? '/api/session'
							: `/api/session/${encodeURIComponent(sessionId)}`,
						sessionId === undefined
							? { location: { directory: cwd } }
							: undefined,
					);
					return yield* HttpClientResponse.schemaBodyJson(ApiSessionResponse)(
						response,
					).pipe(Effect.map((body) => body.data));
				});

			const serviceStatus = (binaryPath: string) =>
				Effect.gen(function* () {
					const status = yield* runServiceCommand(
						binaryPath,
						['service', 'status'],
						'checking service status',
					);
					if (status.exitCode !== 0 || isOpenCodeServiceStopped(status.stdout))
						return { running: false as const };
					const service = yield* discover(binaryPath);
					const response = yield* request(binaryPath, 'GET', '/api/info');
					const info =
						yield* HttpClientResponse.schemaBodyJson(ServiceInfoResponse)(
							response,
						);
					return {
						running: true as const,
						url: service.url,
						version: info.version,
					};
				});

			const serviceControl = (binaryPath: string, action: 'start' | 'stop') =>
				Effect.gen(function* () {
					const result = yield* runServiceCommand(
						binaryPath,
						['service', action],
						`running service ${action}`,
					);
					if (result.exitCode !== 0)
						return yield* commandExitError(
							`running service ${action}`,
							`opencode service ${action}`,
							result,
						);
				});

			return {
				steer,
				disableQuestion,
				isSessionActive,
				forkSession,
				getLatestMessageId,
				getFirstMessageAfter,
				request,
				apiSession,
				serviceStatus,
				serviceControl,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(
		OpenCodeServiceClient,
		OpenCodeServiceClient.make,
	).pipe(Layer.provide(FetchHttpClient.layer));
}
