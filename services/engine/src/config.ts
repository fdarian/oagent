import { Config, Effect, Option, Schema } from 'effect';
import type { ConfigError } from 'effect/Config';
import { FileSystem } from 'effect/FileSystem';
import { Path } from 'effect/Path';
import type { PlatformError } from 'effect/PlatformError';
import { getOagentBaseDir } from './paths.ts';

const ConfigSchema = Schema.Struct({
	portless: Schema.Boolean.pipe(
		Schema.optional,
		Schema.withDecodingDefaultType(Effect.succeed(false)),
	),
});
const ConfigSchemaFromJson = Schema.fromJsonString(ConfigSchema);

export type OagentConfig = Schema.Schema.Type<typeof ConfigSchema>;

function resolveConfigPath(): Effect.Effect<string, ConfigError, Path> {
	return Effect.gen(function* () {
		const path = yield* Path;
		const pathFromEnv = Option.getOrNull(
			yield* Config.String('OAGENT_CONFIG_PATH').pipe(Config.option),
		);
		if (pathFromEnv) {
			return path.resolve(pathFromEnv);
		}

		const baseDir = yield* getOagentBaseDir;
		return path.join(baseDir, 'config.json');
	});
}

export function loadConfig(): Effect.Effect<
	OagentConfig,
	ConfigError | Schema.SchemaError | PlatformError | Error,
	FileSystem | Path
> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const configPath = yield* resolveConfigPath();

		if (!(yield* fs.exists(configPath))) {
			return yield* Schema.decodeEffect(ConfigSchema)({});
		}

		const raw = yield* fs.readFileString(configPath);
		return yield* Schema.decodeEffect(ConfigSchemaFromJson)(raw);
	});
}
