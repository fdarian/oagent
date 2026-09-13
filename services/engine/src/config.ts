import { Effect, Schema } from 'effect';
import type { ConfigError } from 'effect/Config';
import { FileSystem } from 'effect/FileSystem';
import type { Path } from 'effect/Path';
import type { PlatformError } from 'effect/PlatformError';
import { getOagentConfigPath } from './paths.ts';

const ConfigSchema = Schema.Struct({
	portless: Schema.Boolean.pipe(
		Schema.optional,
		Schema.withDecodingDefaultType(Effect.succeed(false)),
	),
});
const ConfigSchemaFromJson = Schema.fromJsonString(ConfigSchema);

export type OagentConfig = Schema.Schema.Type<typeof ConfigSchema>;

export function loadConfig(): Effect.Effect<
	OagentConfig,
	ConfigError | Schema.SchemaError | PlatformError | Error,
	FileSystem | Path
> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const configPath = yield* getOagentConfigPath;

		if (!(yield* fs.exists(configPath))) {
			return yield* Schema.decodeEffect(ConfigSchema)({});
		}

		const raw = yield* fs.readFileString(configPath);
		return yield* Schema.decodeEffect(ConfigSchemaFromJson)(raw);
	});
}
