import type { PlatformError } from '@effect/platform/Error';
import { FileSystem } from '@effect/platform/FileSystem';
import { Path } from '@effect/platform/Path';
import {
	Config,
	type ConfigError,
	Effect,
	Option,
	type ParseResult,
	Schema,
} from 'effect';
import { getOagentBaseDir } from './paths.ts';

const ConfigSchema = Schema.Struct({
	portless: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});
const ConfigSchemaFromJson = Schema.parseJson(ConfigSchema);

export type OagentConfig = Schema.Schema.Type<typeof ConfigSchema>;

function resolveConfigPath(): Effect.Effect<
	string,
	ConfigError.ConfigError,
	Path
> {
	return Effect.gen(function* () {
		const path = yield* Path;
		const pathFromEnv = Option.getOrNull(
			yield* Config.string('OAGENT_CONFIG_PATH').pipe(Config.option),
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
	ConfigError.ConfigError | ParseResult.ParseError | PlatformError | Error,
	FileSystem | Path
> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem;
		const configPath = yield* resolveConfigPath();

		if (!(yield* fs.exists(configPath))) {
			return yield* Schema.decode(ConfigSchema)({});
		}

		const raw = yield* fs.readFileString(configPath);
		return yield* Schema.decode(ConfigSchemaFromJson)(raw);
	});
}
