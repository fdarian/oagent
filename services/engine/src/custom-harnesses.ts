import { eq } from 'drizzle-orm';
import {
	Context,
	Duration,
	Effect,
	Exit,
	Fiber,
	Layer,
	Schema,
	Scope,
	Semaphore,
} from 'effect';
import { AcpSessionError } from './acp-agent.ts';
import { makeAcpAdapterHarness } from './acp-harness.ts';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import {
	type AcpCommand,
	type Harness,
	type HarnessId,
	HarnessSteerError,
	INLINE_ACP_HARNESS_ID,
	isCustomHarnessIdFormat,
	isReservedHarnessId,
	UnknownHarness,
} from './harness.ts';
import { Settings } from './settings.ts';

export type CustomHarnessDefinition = {
	readonly id: HarnessId;
	readonly name: string;
	readonly binary: string;
	readonly args: ReadonlyArray<string>;
	readonly createdAt: Date;
	readonly updatedAt: Date;
};

export type CustomHarnessInput = {
	readonly id: HarnessId;
	readonly name: string;
	readonly binary: string;
	readonly args: ReadonlyArray<string>;
};

export class CustomHarnessError extends Schema.TaggedError<CustomHarnessError>()(
	'CustomHarnessError',
	{
		code: Schema.Literals([
			'INVALID_ID',
			'RESERVED_ID',
			'ALREADY_EXISTS',
			'INVALID_DEFINITION',
		]),
		message: Schema.String,
	},
) {}

/** The part of a definition that determines how its ACP subprocess is launched. */
type LaunchSpec = {
	readonly id: HarnessId;
	readonly binary: string;
	readonly args: ReadonlyArray<string>;
};

/**
 * A running adapter and its subprocess. `uses` counts the turns, steers and
 * forks currently holding it, so a definition edit can retire it without
 * killing work in flight.
 */
type Instance = {
	readonly key: string;
	readonly inline: boolean;
	readonly harness: Harness;
	readonly scope: Scope.Closeable;
	uses: number;
	/** Replaced or deleted: no longer resolvable, closed once its last use ends. */
	retired: boolean;
	closed: boolean;
	idleEviction: Fiber.Fiber<void> | undefined;
};

/** How long an inline instance with no uses keeps its subprocess alive. */
export const INLINE_IDLE_TIME_TO_LIVE = Duration.minutes(5);

const inlineInstanceKey = (command: AcpCommand) =>
	`inline:${new Bun.CryptoHasher('sha256')
		.update(JSON.stringify([command.binary, command.args]))
		.digest('hex')}`;

const toDefinition = (
	row: typeof schema.customHarnesses.$inferSelect,
): CustomHarnessDefinition => ({
	id: row.id,
	name: row.name,
	binary: row.binary,
	args: row.args,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
});

const validateFields = (input: Omit<CustomHarnessInput, 'id'>) =>
	input.name.trim().length === 0
		? new CustomHarnessError({
				code: 'INVALID_DEFINITION',
				message: 'Harness name is required.',
			})
		: input.binary.trim().length === 0
			? new CustomHarnessError({
					code: 'INVALID_DEFINITION',
					message: 'Harness command is required.',
				})
			: Effect.void;

export const validateCustomHarnessId = (id: string) => {
	if (!isCustomHarnessIdFormat(id)) {
		return new CustomHarnessError({
			code: 'INVALID_ID',
			message: `Harness id "${id}" is invalid. Use 1-32 lowercase letters, digits or hyphens, starting with a letter.`,
		});
	}
	if (isReservedHarnessId(id)) {
		return new CustomHarnessError({
			code: 'RESERVED_ID',
			message: `Harness id "${id}" is reserved.`,
		});
	}
	return Effect.void;
};

export const makeCustomHarnesses = (options: {
	readonly inlineIdleTimeToLive: Duration.Input;
}) =>
	Effect.gen(function* () {
		const db = (yield* Db).db;
		const settings = yield* Settings;
		const serviceScope = yield* Scope.Scope;
		const lock = yield* Semaphore.make(1);

		// Each instance owns a scope, so its ACP connection (an RcRef inside
		// `AcpAgent`) lives and dies with the definition it was built from.
		// Saved definitions are keyed by id; inline `--acp` definitions by a
		// hash of binary+args, with a prefix that no slug id can collide with.
		const instances = new Map<string, Instance>();
		// Retired instances still serving a turn; they leave this set when closed.
		const retiredInstances = new Set<Instance>();

		const closeInstance = (instance: Instance) =>
			Effect.suspend(() => {
				if (instance.closed) return Effect.void;
				instance.closed = true;
				retiredInstances.delete(instance);
				return Scope.close(instance.scope, Exit.succeed(undefined));
			});

		const cancelIdleEviction = (instance: Instance) =>
			Effect.suspend(() => {
				const pending = instance.idleEviction;
				instance.idleEviction = undefined;
				return pending === undefined ? Effect.void : Fiber.interrupt(pending);
			});

		const scheduleIdleEviction = (instance: Instance) =>
			Effect.gen(function* () {
				const previous = instance.idleEviction;
				instance.idleEviction = yield* Effect.sleep(
					options.inlineIdleTimeToLive,
				).pipe(
					Effect.andThen(
						Effect.suspend(() => {
							instance.idleEviction = undefined;
							if (
								instance.uses > 0 ||
								instances.get(instance.key) !== instance
							) {
								return Effect.void;
							}
							instances.delete(instance.key);
							return closeInstance(instance);
						}).pipe(Effect.uninterruptible),
					),
					Effect.forkIn(serviceScope),
				);
				if (previous !== undefined) yield* Fiber.interrupt(previous);
			});

		/**
		 * Holds `instance` open while `effect` runs. A caller that resolved the
		 * harness before it was retired may still start a use as long as the
		 * subprocess is alive; once it is closed there is nothing to hold.
		 */
		const holdUse = <A, E, R, EClosed>(
			instance: Instance,
			closedError: EClosed,
			effect: Effect.Effect<A, E, R>,
		) =>
			Effect.acquireUseRelease(
				Effect.suspend(() => {
					if (instance.closed) return Effect.fail(closedError);
					instance.uses += 1;
					return cancelIdleEviction(instance);
				}),
				() => effect,
				() =>
					Effect.suspend(() => {
						instance.uses -= 1;
						if (instance.uses > 0) return Effect.void;
						if (instance.retired) return closeInstance(instance);
						return instance.inline
							? scheduleIdleEviction(instance)
							: Effect.void;
					}),
			);

		const closedFor = (instance: Instance) =>
			new Error(
				`Harness "${instance.harness.backend}" was changed or removed before this call started.`,
			);

		const withUses = (raw: Harness, instance: () => Instance): Harness => {
			const rawSteer = raw.steer;
			const rawFork = raw.forkSession;
			return {
				...raw,
				runTurn: (input) =>
					holdUse(
						instance(),
						new AcpSessionError({ cause: closedFor(instance()) }),
						raw.runTurn(input),
					),
				...(rawSteer === undefined
					? {}
					: {
							steer: (input: { sessionId: string; text: string }) =>
								holdUse(
									instance(),
									new HarnessSteerError({
										code: 'NOT_RUNNING',
										message: closedFor(instance()).message,
										cause: closedFor(instance()),
									}),
									rawSteer(input),
								),
						}),
				...(rawFork === undefined
					? {}
					: {
							forkSession: (input: { sessionId: string; cwd: string }) =>
								holdUse(
									instance(),
									new AcpSessionError({ cause: closedFor(instance()) }),
									rawFork(input),
								),
						}),
			};
		};

		const buildInstance = (key: string, spec: LaunchSpec, inline: boolean) =>
			Effect.gen(function* () {
				const adapter = makeAcpAdapterHarness({
					backend: spec.id,
					defaultBinary: spec.binary,
					args: spec.args,
				});
				const scope = yield* Scope.make();
				const raw = yield* Layer.buildWithScope(adapter.acpLayer, scope).pipe(
					Effect.flatMap((context) =>
						adapter.make.pipe(Effect.provide(context)),
					),
					Effect.provideService(Settings, settings),
					Effect.onError(() => Scope.close(scope, Exit.succeed(undefined))),
				);
				const instance: Instance = {
					key,
					inline,
					harness: withUses(raw, () => instance),
					scope,
					uses: 0,
					retired: false,
					closed: false,
					idleEviction: undefined,
				};
				return instance;
			});

		const acquireInstance = (key: string, spec: LaunchSpec, inline: boolean) =>
			Effect.gen(function* () {
				const existing = instances.get(key);
				if (existing !== undefined) {
					// Resolving is the start of a use, so restart the idle window.
					if (inline && existing.uses === 0) {
						yield* scheduleIdleEviction(existing);
					}
					return existing.harness;
				}
				const built = yield* buildInstance(key, spec, inline);
				instances.set(key, built);
				if (inline) yield* scheduleIdleEviction(built);
				return built.harness;
			});

		const retireInstance = (key: string) =>
			Effect.suspend(() => {
				const existing = instances.get(key);
				if (existing === undefined) return Effect.void;
				instances.delete(key);
				existing.retired = true;
				if (existing.uses === 0) return closeInstance(existing);
				retiredInstances.add(existing);
				return Effect.void;
			});

		yield* Effect.addFinalizer(() =>
			Effect.forEach(
				[...instances.values(), ...retiredInstances],
				(instance) =>
					cancelIdleEviction(instance).pipe(
						Effect.andThen(closeInstance(instance)),
					),
				{ discard: true },
			).pipe(Effect.tap(() => Effect.sync(() => instances.clear()))),
		);

		const findRow = (id: HarnessId) =>
			isCustomHarnessIdFormat(id)
				? db
						.select()
						.from(schema.customHarnesses)
						.where(eq(schema.customHarnesses.id, id))
						.limit(1)
						.get()
				: undefined;

		const list = (): ReadonlyArray<CustomHarnessDefinition> =>
			db
				.select()
				.from(schema.customHarnesses)
				.orderBy(schema.customHarnesses.created_at)
				.all()
				.map(toDefinition);

		const get = (id: HarnessId) =>
			Effect.suspend(() => {
				const row = findRow(id);
				return row === undefined
					? Effect.fail(new UnknownHarness({ harnessId: id }))
					: Effect.succeed(toDefinition(row));
			});

		const resolve = (id: HarnessId) =>
			lock.withPermit(
				Effect.gen(function* () {
					const definition = yield* get(id);
					return yield* acquireInstance(definition.id, definition, false);
				}),
			);

		const resolveInline = (command: AcpCommand) =>
			lock.withPermit(
				acquireInstance(
					inlineInstanceKey(command),
					{
						id: INLINE_ACP_HARNESS_ID,
						binary: command.binary,
						args: command.args,
					},
					true,
				),
			);

		const resolveAll = () =>
			lock.withPermit(
				Effect.forEach(list(), (definition) =>
					acquireInstance(definition.id, definition, false),
				),
			);

		const create = (input: CustomHarnessInput) =>
			Effect.gen(function* () {
				yield* validateCustomHarnessId(input.id);
				yield* validateFields(input);
				if (findRow(input.id) !== undefined) {
					return yield* new CustomHarnessError({
						code: 'ALREADY_EXISTS',
						message: `A harness with id "${input.id}" already exists.`,
					});
				}
				const now = new Date();
				db.insert(schema.customHarnesses)
					.values({
						id: input.id,
						name: input.name.trim(),
						binary: input.binary.trim(),
						args: [...input.args],
						created_at: now,
						updated_at: now,
					})
					.run();
				return yield* get(input.id);
			});

		const update = (input: CustomHarnessInput) =>
			lock.withPermit(
				Effect.gen(function* () {
					yield* get(input.id);
					yield* validateFields(input);
					db.update(schema.customHarnesses)
						.set({
							name: input.name.trim(),
							binary: input.binary.trim(),
							args: [...input.args],
							updated_at: new Date(),
						})
						.where(eq(schema.customHarnesses.id, input.id))
						.run();
					yield* retireInstance(input.id);
					return yield* get(input.id);
				}),
			);

		const remove = (id: HarnessId) =>
			lock.withPermit(
				Effect.gen(function* () {
					yield* get(id);
					db.transaction((tx) => {
						tx.delete(schema.harnesses)
							.where(eq(schema.harnesses.backend, id))
							.run();
						tx.delete(schema.customHarnesses)
							.where(eq(schema.customHarnesses.id, id))
							.run();
					});
					settings.setHarnessEnv(id, {});
					yield* retireInstance(id);
				}),
			);

		return {
			list,
			get,
			create,
			update,
			remove,
			resolve,
			resolveInline,
			resolveAll,
		};
	});

export class CustomHarnesses extends Context.Service<CustomHarnesses>()(
	'oagent/CustomHarnesses',
	{
		make: makeCustomHarnesses({
			inlineIdleTimeToLive: INLINE_IDLE_TIME_TO_LIVE,
		}),
	},
) {
	static readonly layer = Layer.effect(
		CustomHarnesses,
		CustomHarnesses.make,
	).pipe(Layer.provide(Db.layer), Layer.provide(Settings.layer));
}
