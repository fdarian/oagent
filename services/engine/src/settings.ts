import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { Db } from './db/client.ts';
import * as schema from './db/schema.ts';

const CODEX_HOME_KEY = 'codex_home';

function expandHome(value: string): string {
	if (value === '~') return os.homedir();
	if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
	return value;
}

export class Settings extends Context.Service<Settings>()('oagent/Settings', {
	make: Effect.gen(function* () {
		const dbService = yield* Db;
		const db = dbService.db;

		const getSetting = (key: string): string | undefined => {
			const row = db
				.select()
				.from(schema.settings)
				.where(eq(schema.settings.key, key))
				.limit(1)
				.get();
			if (row === undefined) return undefined;
			return row.value;
		};

		const setSetting = (key: string, value: string) => {
			const now = new Date();
			db.insert(schema.settings)
				.values({
					key,
					value,
					created_at: now,
					updated_at: now,
				})
				.onConflictDoUpdate({
					target: schema.settings.key,
					set: {
						value,
						updated_at: now,
					},
				})
				.run();
		};

		const deleteSetting = (key: string) => {
			db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
		};

		const getCodexHome = (): string | undefined => {
			const value = getSetting(CODEX_HOME_KEY);
			return value === undefined ? undefined : expandHome(value);
		};

		const setCodexHome = (value: string | null | undefined) => {
			if (value === undefined || value === null || value.trim() === '') {
				deleteSetting(CODEX_HOME_KEY);
				return;
			}
			setSetting(CODEX_HOME_KEY, value);
		};

		return {
			getSetting,
			setSetting,
			getCodexHome,
			setCodexHome,
		};
	}),
}) {
	static readonly layer = Layer.effect(Settings, Settings.make).pipe(
		Layer.provide(Db.layer),
	);
}
