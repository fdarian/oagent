import type { AgentDefinition, AliasPreset } from '@oagent/engine';
import { Effect, Schema } from 'effect';
import { FileSystem } from 'effect/FileSystem';

const text = Schema.String.check(Schema.isMinLength(1));
const backend = Schema.Literals([
	'opencode',
	'cursor',
	'grok',
	'codex',
	'claude',
]);
const aliasSchema = Schema.Struct({
	name: text,
	backend,
	model_id: text,
	reasoning_effort: Schema.optional(text),
});
const agentsSchema = Schema.Record(
	text,
	Schema.Struct({
		description: Schema.optional(Schema.String),
		targets: Schema.Record(text, text),
	}),
);

export function parseAliases(values: ReadonlyArray<string>) {
	return Effect.forEach(values, (value) => {
		const match = /^([^=:#]+)=([^:]+):([^#]+)(?:#(.+))?$/.exec(value);
		return Schema.decodeUnknownEffect(aliasSchema)(
			match === null
				? value
				: {
						name: match[1],
						backend: match[2],
						model_id: match[3],
						reasoning_effort: match[4],
					},
		);
	});
}

export function parseAgents(value: string | undefined) {
	return Effect.gen(function* () {
		if (value === undefined) return [] as AgentDefinition[];
		const fs = yield* FileSystem;
		const json = value.startsWith('@')
			? yield* fs.readFileString(value.slice(1))
			: value;
		const decoded = yield* Schema.decodeUnknownEffect(
			Schema.fromJsonString(agentsSchema),
		)(json);
		return yield* Effect.forEach(Object.entries(decoded), (entry) =>
			Schema.decodeUnknownEffect(
				Schema.Struct({
					name: text,
					description: Schema.optional(Schema.String),
					targets: Schema.Array(Schema.Struct({ backend, target: text })),
				}),
			)({
				name: entry[0],
				description: entry[1].description,
				targets: Object.entries(entry[1].targets).map((target) => ({
					backend: target[0],
					target: target[1],
				})),
			}),
		);
	});
}

export function overlay<T extends { name: string }>(
	base: ReadonlyArray<T>,
	flags: ReadonlyArray<T>,
): T[] {
	return [
		...new Map(
			[...base, ...flags].map((entry) => [entry.name, entry]),
		).values(),
	];
}

export function resolveModel(
	value: string | undefined,
	aliases: ReadonlyArray<AliasPreset>,
	bare: boolean,
) {
	if (value === undefined || value.includes(':')) return Effect.succeed(value);
	const hash = value.lastIndexOf('#');
	const name = hash < 0 ? value : value.slice(0, hash);
	const alias = aliases.find((entry) => entry.name === name);
	if (alias === undefined)
		return bare
			? Effect.fail(new Error(`Unknown alias: ${name}`))
			: Effect.succeed(value);
	const effort = hash < 0 ? alias.reasoning_effort : value.slice(hash + 1);
	return Effect.succeed(
		`${alias.backend}:${alias.model_id}${effort ? `#${effort}` : ''}`,
	);
}

export function resolveAgent(
	name: string | undefined,
	agents: ReadonlyArray<AgentDefinition>,
	bare: boolean,
): Effect.Effect<
	{ agent: AgentDefinition | undefined; agent_type: string | undefined },
	Error
> {
	const agent = agents.find((entry) => entry.name === name);
	if (agent !== undefined)
		return Effect.succeed({ agent, agent_type: undefined });
	return bare && name !== undefined
		? Effect.fail(new Error(`Unknown agent: ${name}`))
		: Effect.succeed({ agent: undefined, agent_type: name });
}
