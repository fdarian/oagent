import { and, eq, inArray } from 'drizzle-orm';
import { Context, Effect, Layer, Schema } from 'effect';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';
import type { Backend } from './model-catalog.ts';

export type AgentHarnessTarget = {
	readonly backend: Backend;
	readonly target: string;
};

export type AgentDefinition = {
	readonly name: string;
	readonly targets: ReadonlyArray<AgentHarnessTarget>;
};

export class AgentTypeNotFound extends Schema.TaggedError<AgentTypeNotFound>()(
	'AgentTypeNotFound',
	{
		agentType: Schema.String,
		configuredAgentTypes: Schema.Array(Schema.String),
	},
) {
	override get message() {
		const configured =
			this.configuredAgentTypes.length === 0
				? 'none'
				: this.configuredAgentTypes.map((name) => `"${name}"`).join(', ');
		return `Agent type "${this.agentType}" is not configured. Configured agent types: ${configured}.`;
	}
}

export class AgentNotMappedForBackend extends Schema.TaggedError<AgentNotMappedForBackend>()(
	'AgentNotMappedForBackend',
	{
		agentType: Schema.String,
		backend: Schema.String,
	},
) {
	override get message() {
		return `Agent type "${this.agentType}" is not mapped for backend "${this.backend}".`;
	}
}

function parseBackend(value: string): Backend {
	if (
		value === 'opencode' ||
		value === 'cursor' ||
		value === 'grok' ||
		value === 'codex'
	) {
		return value;
	}
	throw new Error(`Invalid persisted agent target backend: ${value}`);
}

export class Agents extends Context.Service<Agents>()('oagent/Agents', {
	make: Effect.gen(function* () {
		const dbService = yield* Db;
		const db = dbService.db;

		const list = (): ReadonlyArray<AgentDefinition> => {
			const agentRows = db
				.select()
				.from(schema.agents)
				.orderBy(schema.agents.name)
				.all();
			if (agentRows.length === 0) return [];

			const targetRows = db
				.select()
				.from(schema.agentHarnessTargets)
				.where(
					inArray(
						schema.agentHarnessTargets.agent_id,
						agentRows.map((agent) => agent.id),
					),
				)
				.orderBy(
					schema.agentHarnessTargets.agent_id,
					schema.agentHarnessTargets.backend,
				)
				.all();
			const targetsByAgent = new Map<number, Array<AgentHarnessTarget>>(
				agentRows.map((agent) => [agent.id, []]),
			);
			for (const targetRow of targetRows) {
				const target = {
					backend: parseBackend(targetRow.backend),
					target: targetRow.target,
				};
				const targets = targetsByAgent.get(targetRow.agent_id);
				if (targets === undefined) {
					throw new Error(
						`Agent target references missing agent ${targetRow.agent_id}`,
					);
				}
				targets.push(target);
			}

			return agentRows.map((agentRow) => {
				const targets = targetsByAgent.get(agentRow.id);
				if (targets === undefined) {
					throw new Error(`Missing target collection for agent ${agentRow.id}`);
				}
				return { name: agentRow.name, targets };
			});
		};

		const save = (input: AgentDefinition): AgentDefinition => {
			const now = new Date();
			db.transaction((tx) => {
				const agentRow = tx
					.insert(schema.agents)
					.values({
						name: input.name,
						created_at: now,
						updated_at: now,
					})
					.onConflictDoUpdate({
						target: schema.agents.name,
						set: { updated_at: now },
					})
					.returning({ id: schema.agents.id })
					.get();
				if (agentRow === undefined) {
					throw new Error(`Failed to save agent type "${input.name}"`);
				}

				tx.delete(schema.agentHarnessTargets)
					.where(eq(schema.agentHarnessTargets.agent_id, agentRow.id))
					.run();
				if (input.targets.length > 0) {
					tx.insert(schema.agentHarnessTargets)
						.values(
							input.targets.map((target) => ({
								agent_id: agentRow.id,
								backend: target.backend,
								target: target.target,
								created_at: now,
								updated_at: now,
							})),
						)
						.run();
				}
			});

			return {
				name: input.name,
				targets: input.targets.map((target) => ({
					backend: target.backend,
					target: target.target,
				})),
			};
		};

		const deleteAgent = (name: string): boolean => {
			const existing = db
				.select({ id: schema.agents.id })
				.from(schema.agents)
				.where(eq(schema.agents.name, name))
				.limit(1)
				.get();
			if (existing === undefined) return false;
			db.delete(schema.agents).where(eq(schema.agents.id, existing.id)).run();
			return true;
		};

		const resolve = (
			name: string,
			backend: Backend,
		): Effect.Effect<
			string,
			AgentTypeNotFound | AgentNotMappedForBackend,
			never
		> =>
			Effect.gen(function* () {
				const agent = db
					.select({ id: schema.agents.id })
					.from(schema.agents)
					.where(eq(schema.agents.name, name))
					.limit(1)
					.get();
				if (agent === undefined) {
					const configuredAgentTypes = db
						.select({ name: schema.agents.name })
						.from(schema.agents)
						.orderBy(schema.agents.name)
						.all()
						.map((row) => row.name);
					return yield* new AgentTypeNotFound({
						agentType: name,
						configuredAgentTypes,
					});
				}

				const mapping = db
					.select({ target: schema.agentHarnessTargets.target })
					.from(schema.agentHarnessTargets)
					.where(
						and(
							eq(schema.agentHarnessTargets.agent_id, agent.id),
							eq(schema.agentHarnessTargets.backend, backend),
						),
					)
					.limit(1)
					.get();
				if (mapping === undefined) {
					return yield* new AgentNotMappedForBackend({
						agentType: name,
						backend,
					});
				}
				return mapping.target;
			});

		return { list, save, delete: deleteAgent, resolve };
	}),
}) {
	static readonly layer = Layer.effect(Agents, Agents.make).pipe(
		Layer.provide(Db.layer),
	);
}
