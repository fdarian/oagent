import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Config, type ConfigError, Effect, Option, ParseResult, Schema } from 'effect';

const ConfigSchema = Schema.Struct({
	portless: Schema.optionalWith(Schema.Boolean, { default: () => false }),
});

export type OagentConfig = Schema.Schema.Type<typeof ConfigSchema>;

function resolveConfigPath(): Effect.Effect<
	string,
	ConfigError.ConfigError
> {
	return Effect.gen(function* () {
		const pathFromEnv = Option.getOrNull(
			yield* Config.string('OAGENT_CONFIG_PATH').pipe(Config.option),
		);
		if (pathFromEnv) {
			return path.resolve(pathFromEnv);
		}

		const dir = path.join(os.homedir(), '.config', 'oagent');
		return path.join(dir, 'config.json');
	});
}

export function loadConfig(): Effect.Effect<
	OagentConfig,
	ConfigError.ConfigError | ParseResult.ParseError | Error
> {
	return Effect.gen(function* () {
		const configPath = yield* resolveConfigPath();

		if (!fs.existsSync(configPath)) {
			return yield* Schema.decode(ConfigSchema)({});
		}

		const parsed = yield* Effect.try({
			try: () => {
				const raw = fs.readFileSync(configPath, 'utf-8');
				return JSON.parse(raw);
			},
			catch: (cause) =>
				new Error(
					`Failed to read/parse config file at ${configPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
				),
		});

		return yield* Schema.decode(ConfigSchema)(parsed);
	});
}
