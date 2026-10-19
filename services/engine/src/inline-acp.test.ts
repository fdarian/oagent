import { afterEach, describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { Effect, Exit, Scope } from 'effect';
import { Agents } from './agents.ts';
import { Claude } from './claude.ts';
import { Codex } from './codex.ts';
import { Cursor } from './cursor.ts';
import { CustomHarnesses } from './custom-harnesses.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import { Grok } from './grok.ts';
import { HarnessRegistry } from './harness-registry.ts';
import { recoveryDecision } from './job-recovery.ts';
import { Jobs } from './jobs.ts';
import { OpenCode } from './opencode.ts';
import { Pi } from './pi.ts';
import { Sessions } from './sessions.ts';
import { Settings } from './settings.ts';
import { createTestDatabase } from './test-database.ts';
import { Worktrees } from './worktree.ts';

const agentScript = fileURLToPath(
	new URL('./test-acp-agent.ts', import.meta.url),
);

const stub = (backend: string) => ({ backend }) as never;

let commandCounter = 0;
// Inline instances are cached per binary+args, so each test needs its own
// command to get a subprocess that sees that test's environment.
const freshCommand = () => ({
	binary: process.execPath,
	args: [agentScript, `--test=${commandCounter++}`],
});

const testEnvKeys = [
	'TEST_ACP_MODELS',
	'TEST_ACP_MODEL_CONFIG_ID',
	'TEST_ACP_FORK',
];
afterEach(() => {
	for (const key of testEnvKeys) delete process.env[key];
});

function createEnvironment() {
	const database = createTestDatabase();
	const dbService = {
		db: database.db,
		sqlite: database.sqlite,
	} as unknown as Db['Service'];
	const scope = Effect.runSync(Scope.make());
	const settings = Effect.runSync(
		Settings.make.pipe(Effect.provideService(Db, dbService)),
	);
	const customHarnesses = Effect.runSync(
		CustomHarnesses.make.pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.provideService(Db, dbService),
			Effect.provideService(Settings, settings),
		),
	);
	const registry = Effect.runSync(
		HarnessRegistry.make.pipe(
			Effect.provideService(OpenCode, stub('opencode')),
			Effect.provideService(Cursor, stub('cursor')),
			Effect.provideService(Grok, stub('grok')),
			Effect.provideService(Codex, stub('codex')),
			Effect.provideService(Claude, stub('claude')),
			Effect.provideService(Pi, stub('pi')),
			Effect.provideService(CustomHarnesses, customHarnesses),
		),
	);
	const worktrees = {
		ensureEnabled: () => Effect.void,
	} as unknown as Worktrees['Service'];
	const makeJobs = () =>
		Jobs.make.pipe(
			Effect.provideService(Scope.Scope, scope),
			Effect.provideService(Db, dbService),
			Effect.provideService(HarnessRegistry, registry),
			Effect.provideService(Agents, {} as Agents['Service']),
			Effect.provideService(Worktrees, worktrees),
		);
	const jobs = Effect.runSync(makeJobs());
	const sessions = Effect.runSync(
		Sessions.make.pipe(
			Effect.provideService(Db, dbService),
			Effect.provideService(HarnessRegistry, registry),
			Effect.provideService(Jobs, jobs),
			Effect.provideService(Worktrees, worktrees),
		),
	);
	return {
		database,
		customHarnesses,
		registry,
		jobs,
		sessions,
		makeJobs,
		close: () => Effect.runPromise(Scope.close(scope, Exit.succeed(undefined))),
	};
}

type Environment = ReturnType<typeof createEnvironment>;

const sessionRow = (environment: Environment, uuid: string) => {
	const row = environment.database.db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.uuid, uuid))
		.get();
	if (row === undefined) throw new Error(`Missing session ${uuid}`);
	return row;
};

const jobRow = (environment: Environment, uuid: string) => {
	const row = environment.database.db
		.select()
		.from(schema.jobs)
		.where(eq(schema.jobs.uuid, uuid))
		.get();
	if (row === undefined) throw new Error(`Missing job ${uuid}`);
	return row;
};

const finish = (environment: Environment, jobId: string) =>
	Effect.runPromise(environment.jobs.wait({ jobId, timeoutMs: 10_000 }));

const startInline = (
	environment: Environment,
	input: {
		acp: ReturnType<typeof freshCommand>;
		model?: string;
		prompt?: string;
	},
) =>
	Effect.runPromise(
		environment.sessions.start({
			title: 'Inline',
			prompt: input.prompt ?? 'hi',
			cwd: process.cwd(),
			model: input.model,
			acp: input.acp,
		}),
	);

describe('sessions.start with an inline acp definition', () => {
	test('stores the command and backend, then send reuses the stored command', async () => {
		const environment = createEnvironment();
		const acp = freshCommand();
		const started = await startInline(environment, { acp, model: 'any-model' });
		const first = await finish(environment, started.jobId);
		expect(first.status).toBe('done');

		const session = sessionRow(environment, started.sessionId);
		expect(session.backend).toBe('acp');
		expect(session.acp_command).toEqual(acp);
		expect(jobRow(environment, started.jobId).model).toBe('any-model');

		const sent = await Effect.runPromise(
			environment.sessions.sendMessage({
				sessionId: started.sessionId,
				prompt: 'again',
			}),
		);
		expect(sent.delivery).toBe('started');
		const second = await finish(environment, sent.jobId);
		// Same subprocess answered both turns: the reply is the agent's pid.
		expect(second).toMatchObject({
			status: 'done',
			text: first.status === 'done' ? first.text : '',
		});
		await environment.close();
	});

	test('the registry resolves one harness per command across sessions', async () => {
		const environment = createEnvironment();
		const acp = freshCommand();
		const first = await startInline(environment, { acp, model: 'm' });
		const second = await startInline(environment, { acp, model: 'm' });
		await finish(environment, first.jobId);
		await finish(environment, second.jobId);
		const harnesses = await Effect.runPromise(
			Effect.all([
				environment.registry.resolveForSession(
					sessionRow(environment, first.sessionId),
				),
				environment.registry.resolveForSession(
					sessionRow(environment, second.sessionId),
				),
				environment.registry.resolveForSession({
					backend: 'acp',
					acp_command: freshCommand(),
				}),
			]),
		);
		expect(harnesses[0]).toBe(harnesses[1]);
		expect(harnesses[0]).not.toBe(harnesses[2]);
		await environment.close();
	});

	test('an acp session row without a stored command is an unknown harness', async () => {
		const environment = createEnvironment();
		const error = await Effect.runPromise(
			environment.registry
				.resolveForSession({ backend: 'acp', acp_command: null })
				.pipe(Effect.flip),
		);
		expect(error).toMatchObject({ _tag: 'UnknownHarness', harnessId: 'acp' });
		await environment.close();
	});

	test('rejects acp combined with forkId', async () => {
		const environment = createEnvironment();
		const error = await Effect.runPromise(
			environment.sessions
				.start({
					title: 'x',
					prompt: 'hi',
					cwd: process.cwd(),
					forkId: 'whatever',
					acp: freshCommand(),
				})
				.pipe(Effect.flip),
		);
		expect(error).toMatchObject({
			_tag: 'SessionStartError',
			code: 'ACP_WITH_FORK',
		});
		await environment.close();
	});

	test('rejects a model with a builtin or saved-harness prefix', async () => {
		const environment = createEnvironment();
		await Effect.runPromise(
			environment.customHarnesses.create({
				id: 'my-agent',
				name: 'My agent',
				binary: process.execPath,
				args: [agentScript],
			}),
		);
		for (const model of ['claude:haiku', 'my-agent:m1', 'claude:haiku#high']) {
			const error = await Effect.runPromise(
				environment.sessions
					.start({
						title: 'x',
						prompt: 'hi',
						cwd: process.cwd(),
						model,
						acp: freshCommand(),
					})
					.pipe(Effect.flip),
			);
			expect(error).toMatchObject({
				_tag: 'SessionStartError',
				code: 'ACP_WITH_MODEL_REFERENCE',
			});
		}
		await environment.close();
	});

	test('treats an unrecognised colon-bearing model as a literal adapter id', async () => {
		const environment = createEnvironment();
		const started = await startInline(environment, {
			acp: freshCommand(),
			model: 'vendor/model:latest',
		});
		await finish(environment, started.jobId);
		expect(jobRow(environment, started.jobId).model).toBe(
			'vendor/model:latest',
		);
		await environment.close();
	});

	test('treats an alias name as a literal adapter id', async () => {
		const environment = createEnvironment();
		environment.database.db
			.insert(schema.modelAliases)
			.values({ name: 'fast', backend: 'claude', model_id: 'haiku' })
			.run();
		const started = await startInline(environment, {
			acp: freshCommand(),
			model: 'fast',
		});
		await finish(environment, started.jobId);
		expect(jobRow(environment, started.jobId).model).toBe('fast');
		await environment.close();
	});

	test('rejects an empty binary', async () => {
		const environment = createEnvironment();
		const error = await Effect.runPromise(
			environment.sessions
				.start({
					title: 'x',
					prompt: 'hi',
					cwd: process.cwd(),
					acp: { binary: ' ', args: [] },
				})
				.pipe(Effect.flip),
		);
		expect(error).toMatchObject({ code: 'INVALID_ACP' });
		await environment.close();
	});
});

describe('model from the adapter', () => {
	test("persists the adapter's current model on the job so recovery can resume", async () => {
		process.env.TEST_ACP_MODELS = 'm1,m2';
		const environment = createEnvironment();
		const started = await startInline(environment, { acp: freshCommand() });
		const result = await finish(environment, started.jobId);
		expect(result).toMatchObject({ status: 'done' });
		const job = jobRow(environment, started.jobId);
		expect(job.model).toBe('m1');
		expect(
			recoveryDecision({
				runnerAlive: false,
				resumeCount: 0,
				backend: 'acp',
				interruptedAt: new Date(),
				harnessSessionId: 'ses',
				model: job.model,
			}),
		).toBe('resume');

		const sent = await Effect.runPromise(
			environment.sessions.sendMessage({
				sessionId: started.sessionId,
				prompt: 'again',
			}),
		);
		expect(jobRow(environment, sent.jobId).model).toBe('m1');
		await environment.close();
	});

	test('an explicit model is applied and recorded instead of the default', async () => {
		process.env.TEST_ACP_MODELS = 'm1,m2';
		const environment = createEnvironment();
		const started = await startInline(environment, {
			acp: freshCommand(),
			model: 'm2',
		});
		const result = await finish(environment, started.jobId);
		expect(result).toMatchObject({ status: 'done' });
		if (result.status !== 'done') throw new Error('expected done');
		expect(result.text.endsWith(':m2')).toBe(true);
		expect(jobRow(environment, started.jobId).model).toBe('m2');
		await environment.close();
	});

	test('sets the model through the adapter-chosen option id', async () => {
		process.env.TEST_ACP_MODELS = 'm1,m2';
		process.env.TEST_ACP_MODEL_CONFIG_ID = 'model-select';
		const environment = createEnvironment();
		const started = await startInline(environment, {
			acp: freshCommand(),
			model: 'm2',
		});
		const result = await finish(environment, started.jobId);
		expect(result).toMatchObject({ status: 'done' });
		if (result.status !== 'done') throw new Error('expected done');
		expect(result.text.endsWith(':m2')).toBe(true);
		await environment.close();
	});

	test('an adapter that reports no models leaves the job model unset', async () => {
		const environment = createEnvironment();
		const started = await startInline(environment, { acp: freshCommand() });
		const result = await finish(environment, started.jobId);
		expect(result).toMatchObject({ status: 'done' });
		expect(jobRow(environment, started.jobId).model).toBeNull();

		const sent = await Effect.runPromise(
			environment.sessions.sendMessage({
				sessionId: started.sessionId,
				prompt: 'again',
			}),
		);
		expect(sent.delivery).toBe('started');
		await finish(environment, sent.jobId);
		await environment.close();
	});
});

describe('forking and recovering an inline session', () => {
	test('a fork copies the stored command and inherits the model', async () => {
		process.env.TEST_ACP_MODELS = 'm1,m2';
		process.env.TEST_ACP_FORK = '1';
		const environment = createEnvironment();
		const acp = freshCommand();
		const started = await startInline(environment, { acp, model: 'm2' });
		await finish(environment, started.jobId);

		const forked = await Effect.runPromise(
			environment.sessions.start({
				title: 'Fork',
				prompt: 'continue',
				forkId: started.sessionId,
			}),
		);
		const result = await finish(environment, forked.jobId);
		expect(result).toMatchObject({ status: 'done' });
		const forkSession = sessionRow(environment, forked.sessionId);
		expect(forkSession.backend).toBe('acp');
		expect(forkSession.acp_command).toEqual(acp);
		expect(forkSession.harness_session_id).not.toBe(
			sessionRow(environment, started.sessionId).harness_session_id,
		);
		expect(jobRow(environment, forked.jobId).model).toBe('m2');
		await environment.close();
	});

	test('a fork rejects a harness-prefixed model override', async () => {
		process.env.TEST_ACP_FORK = '1';
		const environment = createEnvironment();
		const started = await startInline(environment, {
			acp: freshCommand(),
			model: 'm',
		});
		await finish(environment, started.jobId);
		const error = await Effect.runPromise(
			environment.sessions
				.start({
					title: 'Fork',
					prompt: 'continue',
					forkId: started.sessionId,
					model: 'claude:opus',
				})
				.pipe(Effect.flip),
		);
		expect(error).toMatchObject({ code: 'ACP_WITH_MODEL_REFERENCE' });
		await environment.close();
	});

	test('a fork fails cleanly when the adapter cannot fork', async () => {
		const environment = createEnvironment();
		const started = await startInline(environment, {
			acp: freshCommand(),
			model: 'm',
		});
		await finish(environment, started.jobId);
		const error = await Effect.runPromise(
			environment.sessions
				.start({
					title: 'Fork',
					prompt: 'continue',
					forkId: started.sessionId,
				})
				.pipe(Effect.flip),
		);
		expect(error).toMatchObject({
			_tag: 'SessionForkError',
			code: 'FORK_NOT_SUPPORTED',
		});
		await environment.close();
	});

	test('a side-chat session copies the stored command', async () => {
		const environment = createEnvironment();
		const acp = freshCommand();
		const started = await startInline(environment, { acp, model: 'm' });
		await finish(environment, started.jobId);
		const sideChat = await Effect.runPromise(
			environment.sessions.createSideChatSession({
				sourceJobId: jobRow(environment, started.jobId).id,
			}),
		);
		expect(sideChat.backend).toBe('acp');
		expect(sideChat.acp_command).toEqual(acp);
		await environment.close();
	});

	test('startup recovery resumes an interrupted inline job through the stored command', async () => {
		process.env.TEST_ACP_MODELS = 'm1,m2';
		process.env.TEST_ACP_FORK = '1';
		const environment = createEnvironment();
		const session = environment.database.db
			.insert(schema.sessions)
			.values({
				uuid: 'inline-recovery',
				title: 'Recovery',
				backend: 'acp',
				acp_command: freshCommand(),
				harness_session_id: 'ses-existing',
				cwd: process.cwd(),
				origin_cwd: process.cwd(),
			})
			.returning()
			.get();
		const job = environment.database.db
			.insert(schema.jobs)
			.values({
				uuid: 'inline-recovery-job',
				status: 'running',
				runner_pid: null,
				interrupted_at: new Date(),
				prompt: 'original',
				model: 'm2',
				session_id: session.id,
			})
			.returning()
			.get();

		const recovered = Effect.runSync(environment.makeJobs());
		const result = await Effect.runPromise(
			recovered.wait({ jobId: job.uuid, timeoutMs: 10_000 }),
		);
		expect(result).toMatchObject({ status: 'done' });
		if (result.status !== 'done') throw new Error('expected done');
		expect(result.text.endsWith(':m2')).toBe(true);
		expect(jobRow(environment, job.uuid).resume_count).toBe(1);
		await environment.close();
	});
});
