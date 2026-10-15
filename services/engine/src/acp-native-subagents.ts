import type { AnyMessage, SessionUpdate } from '@agentclientprotocol/sdk';

export const SUBAGENT_META_KEY = 'oagent/subagent';

type SubagentMeta = {
	sessionId: string;
	/** The parent child session, or null when the root session spawned it. */
	parentSessionId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `@agentclientprotocol/sdk` validates `session/update` against a closed union
 * and rejects `subagent_spawned` / `subagent_state_update` before any client
 * handler runs, so they are rewritten into the SDK's standard `subagent_update`
 * on the wire. The rewritten frame carries the child id in
 * `_meta['oagent/subagent']`, which `NativeSubagentRouter` completes.
 */
export function rewriteNativeSubagentMessage(message: AnyMessage): AnyMessage {
	if (!('method' in message) || message.method !== 'session/update') {
		return message;
	}
	const params = message.params;
	if (!isRecord(params) || !isRecord(params.update)) return message;
	const update = params.update;
	const childSessionId = update.subagentSessionId;
	if (typeof childSessionId !== 'string') return message;
	const meta = {
		...(isRecord(update._meta) ? update._meta : {}),
		[SUBAGENT_META_KEY]: { sessionId: childSessionId },
	};
	if (update.sessionUpdate === 'subagent_spawned') {
		return {
			...message,
			params: {
				...params,
				update: {
					sessionUpdate: 'subagent_update',
					sessionId: childSessionId,
					title: update.name,
					description: update.name,
					state: { state: 'running' },
					_meta: meta,
				},
			},
		};
	}
	if (update.sessionUpdate === 'subagent_state_update') {
		return {
			...message,
			params: {
				...params,
				update: {
					sessionUpdate: 'subagent_update',
					sessionId: childSessionId,
					state: { state: update.state },
					_meta: meta,
				},
			},
		};
	}
	return message;
}

function rewrittenChildId(update: SessionUpdate): string | undefined {
	if (update.sessionUpdate !== 'subagent_update') return undefined;
	const meta = update._meta?.[SUBAGENT_META_KEY];
	if (!isRecord(meta) || typeof meta.sessionId !== 'string') return undefined;
	return meta.sessionId;
}

function withSubagentMeta(
	update: SessionUpdate,
	subagent: SubagentMeta,
): SessionUpdate {
	return {
		...update,
		_meta: { ...update._meta, [SUBAGENT_META_KEY]: subagent },
	};
}

/**
 * Tracks which root session owns each native subagent session so that updates
 * and permission requests addressed to a child reach the root turn's listener.
 * Children stay registered after the root's listener goes away: a later turn
 * on the same session can still receive updates from background subagents.
 */
export class NativeSubagentRouter {
	private readonly children = new Map<
		string,
		{ rootSessionId: string; parentSessionId: string | null }
	>();

	constructor(private readonly hasListener: (sessionId: string) => boolean) {}

	/** The session whose turn owns `sessionId`: itself unless it is a known child. */
	rootOf(sessionId: string): string {
		const child = this.children.get(sessionId);
		return child === undefined ? sessionId : child.rootSessionId;
	}

	/** Undefined when no root turn is listening for the update. */
	route(
		sessionId: string,
		update: SessionUpdate,
	): { rootSessionId: string; update: SessionUpdate } | undefined {
		const childSessionId = rewrittenChildId(update);
		if (childSessionId !== undefined) {
			const rootSessionId = this.resolveParent(sessionId);
			if (rootSessionId === undefined) return undefined;
			const parentSessionId = sessionId === rootSessionId ? null : sessionId;
			this.children.set(childSessionId, { rootSessionId, parentSessionId });
			return {
				rootSessionId,
				update: withSubagentMeta(update, {
					sessionId: childSessionId,
					parentSessionId,
				}),
			};
		}
		const child = this.children.get(sessionId);
		if (child !== undefined) {
			return {
				rootSessionId: child.rootSessionId,
				update: withSubagentMeta(update, {
					sessionId,
					parentSessionId: child.parentSessionId,
				}),
			};
		}
		return this.hasListener(sessionId)
			? { rootSessionId: sessionId, update }
			: undefined;
	}

	private resolveParent(sessionId: string): string | undefined {
		const child = this.children.get(sessionId);
		if (child !== undefined) return child.rootSessionId;
		return this.hasListener(sessionId) ? sessionId : undefined;
	}
}
