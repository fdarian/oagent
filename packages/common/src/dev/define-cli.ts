import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as cli from '@effect/cli';
import type { PlatformError } from '@effect/platform/Error';
import type { FileSystem } from '@effect/platform/FileSystem';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Effect, Layer, type Scope } from 'effect';
import {
	type DevSession,
	DevSessions,
	makeDevSessionsLayer,
} from '../dev-sessions.ts';
import { discoveryFile } from './discovery.ts';
import { getStickyPort } from './sticky-port.ts';
import { runManagedSubprocess } from './subprocess.ts';
import { waitForDiscovery } from './wait-discovery.ts';

const DISCOVERY_FILE = '.data/dev.json';

const discoveryPath = (dir: string) => join(dir, DISCOVERY_FILE);

const resolveSiblingDir = (spec: string, fromDir: string) => {
	if (spec.startsWith('.') || spec.startsWith('/')) {
		return resolve(fromDir, spec);
	}
	const pkgJsonPath = Bun.resolveSync(`${spec}/package.json`, fromDir);
	return dirname(realpathSync(pkgJsonPath));
};

type RunContext = {
	session: Effect.Effect<DevSession, PlatformError>;
	getStickyPort: () => ReturnType<typeof getStickyPort>;
	setFile: (data: unknown) => ReturnType<typeof discoveryFile>;
	sibling: (pkgOrPath: string) => {
		getFile: <T>() => Effect.Effect<T, Error, FileSystem>;
	};
	runManagedSubprocess: typeof runManagedSubprocess;
};

type RunEffect = Effect.Effect<
	void,
	unknown,
	DevSessions | BunContext.BunContext | Scope.Scope
>;

export const defineDevCli = (config: {
	name: string;
	dir: string;
	run: (ctx: RunContext) => RunEffect;
}): ((argv: string[]) => void) => {
	const command = cli.Command.make(config.name, {}, () =>
		Effect.gen(function* () {
			const sessions = yield* DevSessions;
			const session = yield* Effect.cached(sessions.getLatestOrCreate);
			return yield* config.run({
				session,
				getStickyPort: () => Effect.flatMap(session, getStickyPort),
				runManagedSubprocess,
				setFile: (data) => discoveryFile(discoveryPath(config.dir), data),
				sibling: (pkgOrPath) => ({
					getFile: <T>() =>
						waitForDiscovery<T>(
							discoveryPath(resolveSiblingDir(pkgOrPath, config.dir)),
							{ parse: (raw) => JSON.parse(raw) as T },
						),
				}),
			});
		}),
	);

	return (argv) => {
		const layer = makeDevSessionsLayer(join(config.dir, '.data/sessions')).pipe(
			Layer.provideMerge(BunContext.layer),
			Layer.provideMerge(Layer.scope),
		);

		const program = cli.Command.run(command, {
			name: config.name,
			version: '0.0.0',
		})(argv);

		BunRuntime.runMain(Effect.provide(program, layer));
	};
};
