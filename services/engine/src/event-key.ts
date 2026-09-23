import type { SessionUpdate } from '@agentclientprotocol/sdk';

export const EVENT_DEDUPE_META_KEY = 'oagent/event-key';

function canonicalEventValue(value: unknown, insideMeta = false): string {
	if (value === undefined) return 'undefined';
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalEventValue(item)).join(',')}]`;
	}
	const object = value as Record<string, unknown>;
	const entries = Object.keys(object)
		.filter((key) => !(insideMeta && key === 'oagent/steer'))
		.sort()
		.map((key) => ({
			key,
			value: canonicalEventValue(object[key], key === '_meta'),
		}))
		.filter((entry) => !(entry.key === '_meta' && entry.value === '{}'));
	return `{${entries
		.map((entry) => `${JSON.stringify(entry.key)}:${entry.value}`)
		.join(',')}}`;
}

/**
 * Uses ACP message/tool identifiers plus the update payload because ACP does
 * not provide a sequence number for session updates. Metadata is part of the
 * payload because some ACP adapters use it to carry extension event data, but
 * the local steering marker is intentionally not part of event identity.
 */
export function eventDedupeKey(event: SessionUpdate): string {
	return `v1:${canonicalEventValue(event)}`;
}
