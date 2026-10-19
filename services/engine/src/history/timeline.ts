import type {
	ContentBlock,
	NoticeSeverity,
	PlanEntry,
	SessionUpdate,
	ToolCallStatus,
	ToolKind,
} from '@agentclientprotocol/sdk';

export type ToolEntry = {
	type: 'tool';
	/** Null until some update for this tool call carries the field. */
	title: string | null;
	kind: ToolKind | null;
	status: ToolCallStatus | null;
	/** File the call acts on, for tools whose title doesn't name it. */
	target: string | null;
};

export type TimelineEntry =
	| { type: 'assistant'; text: string }
	| { type: 'user'; text: string }
	| ToolEntry
	| { type: 'plan'; entries: PlanEntry[] }
	| { type: 'notice'; severity: NoticeSeverity; title: string };

const STEER_META_KEY = 'oagent/steer';

function blockText(block: ContentBlock): string {
	return block.type === 'text' ? block.text : `[${block.type}]`;
}

const RAW_INPUT_PATH_KEYS = ['path', 'file_path', 'filePath'];

function rawInputPath(rawInput: unknown): string | null {
	if (typeof rawInput !== 'object' || rawInput === null) return null;
	const input = rawInput as Record<string, unknown>;
	for (const key of RAW_INPUT_PATH_KEYS) {
		const value = input[key];
		if (typeof value === 'string' && value !== '') return value;
	}
	return null;
}

function isSteer(event: {
	_meta?: { [key: string]: unknown } | null;
}): boolean {
	return event._meta?.[STEER_META_KEY] === true;
}

/**
 * Folds a turn's raw ACP updates into the entries a reader of the turn needs.
 * Dropped updates never break adjacency: only emitted entries are compared when
 * merging text chunks or replacing a plan.
 */
export function foldTimeline(
	events: readonly SessionUpdate[],
): TimelineEntry[] {
	const entries: TimelineEntry[] = [];
	const toolEntries = new Map<string, ToolEntry>();
	// A location-derived target is more reliable than rawInput, so rawInput
	// never replaces one.
	const locationTargets = new Set<string>();

	const appendText = (type: 'assistant' | 'user', text: string) => {
		if (text === '') return;
		const last = entries[entries.length - 1];
		if (last?.type === type) {
			last.text += text;
			return;
		}
		entries.push({ type, text });
	};

	for (const event of events) {
		switch (event.sessionUpdate) {
			case 'agent_message_chunk':
				appendText('assistant', blockText(event.content));
				break;
			case 'user_message_chunk':
				if (isSteer(event)) appendText('user', blockText(event.content));
				break;
			case 'tool_call':
			case 'tool_call_update': {
				const existing = toolEntries.get(event.toolCallId);
				const entry: ToolEntry = existing ?? {
					type: 'tool',
					title: null,
					kind: null,
					status: null,
					target: null,
				};
				entry.title = event.title ?? entry.title;
				entry.kind = event.kind ?? entry.kind;
				entry.status = event.status ?? entry.status;
				const location = event.locations?.[0]?.path;
				if (location !== undefined) {
					entry.target = location;
					locationTargets.add(event.toolCallId);
				} else if (!locationTargets.has(event.toolCallId)) {
					entry.target = rawInputPath(event.rawInput) ?? entry.target;
				}
				if (existing === undefined) {
					toolEntries.set(event.toolCallId, entry);
					entries.push(entry);
				}
				break;
			}
			case 'plan': {
				const last = entries[entries.length - 1];
				if (last?.type === 'plan') {
					last.entries = event.entries;
					break;
				}
				entries.push({ type: 'plan', entries: event.entries });
				break;
			}
			case 'notice':
				entries.push({
					type: 'notice',
					severity: event.severity,
					title: event.title,
				});
				break;
			default:
				break;
		}
	}
	return entries;
}
