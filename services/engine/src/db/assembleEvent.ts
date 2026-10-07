import type {
	AvailableCommand,
	ContentBlock,
	PlanEntry,
	SessionConfigOption,
	SessionUpdate,
	ToolCallContent,
	ToolCallLocation,
} from '@agentclientprotocol/sdk';
import { EVENT_DEDUPE_META_KEY } from '../event-key.ts';
import { fromPatchColumn } from './patch-column.ts';
import type * as schema from './schema.ts';

type EventRow = {
	id: number;
	job_id: number;
	created_at: Date;
	type: (typeof schema.events.$inferSelect)['type'];
	meta: Record<string, unknown> | null;
};

type VariantRow = {
	message_id: string | null;
	content: ContentBlock | null;
	tool_call_id: string | null;
	tool_content: ToolCallContent[] | null;
	title: string | null;
	status: string | null;
	kind: string | null;
	locations: ToolCallLocation[] | null;
	raw_input: unknown | null;
	raw_output: unknown | null;
	entries: PlanEntry[] | null;
	available_commands: AvailableCommand[] | null;
	current_mode_id: string | null;
	config_options: SessionConfigOption[] | null;
	updated_at: string | null;
	size: number | null;
	used: number | null;
	cost_amount: number | null;
	cost_currency: string | null;
	name: string | null;
	plan_update_events: typeof schema.planUpdateEvents.$inferSelect | null;
	plan_removed_events: typeof schema.planRemovedEvents.$inferSelect | null;
	compaction_update_events:
		| typeof schema.compactionUpdateEvents.$inferSelect
		| null;
	compaction_summary_chunk_events:
		| typeof schema.compactionSummaryChunkEvents.$inferSelect
		| null;
	notice_events: typeof schema.noticeEvents.$inferSelect | null;
	subagent_update_events:
		| typeof schema.subagentUpdateEvents.$inferSelect
		| null;
	session_message_events:
		| typeof schema.sessionMessageEvents.$inferSelect
		| null;
	session_message_chunk_events:
		| typeof schema.sessionMessageChunkEvents.$inferSelect
		| null;
};

export function assembleEvent(
	event: EventRow,
	variant: VariantRow,
): SessionUpdate {
	const visibleMetaEntries =
		event.meta === null
			? []
			: Object.entries(event.meta).filter(
					(entry) => entry[0] !== EVENT_DEDUPE_META_KEY,
				);
	const meta =
		visibleMetaEntries.length === 0
			? undefined
			: Object.fromEntries(visibleMetaEntries);

	switch (event.type) {
		case 'user_message_chunk':
		case 'agent_message_chunk':
		case 'agent_thought_chunk': {
			if (variant.content === null) {
				throw new Error(`Missing content for chunk event ${event.id}`);
			}
			return {
				sessionUpdate: event.type,
				...(meta !== undefined ? { _meta: meta } : {}),
				messageId: variant.message_id ?? undefined,
				content: variant.content,
			} as SessionUpdate;
		}

		case 'tool_call':
		case 'tool_call_update': {
			if (variant.tool_call_id === null) {
				throw new Error(`Missing tool_call_id for tool_call event ${event.id}`);
			}
			return {
				sessionUpdate: event.type,
				...(meta !== undefined ? { _meta: meta } : {}),
				toolCallId: variant.tool_call_id,
				name: variant.name ?? undefined,
				title: variant.title ?? undefined,
				status: variant.status ?? undefined,
				kind: variant.kind ?? undefined,
				content: variant.tool_content ?? undefined,
				locations: variant.locations ?? undefined,
				rawInput: variant.raw_input ?? undefined,
				rawOutput: variant.raw_output ?? undefined,
			} as SessionUpdate;
		}

		case 'plan': {
			if (variant.entries === null) {
				throw new Error(`Missing entries for plan event ${event.id}`);
			}
			return {
				sessionUpdate: 'plan',
				...(meta !== undefined ? { _meta: meta } : {}),
				entries: variant.entries,
			} as SessionUpdate;
		}

		case 'available_commands_update': {
			if (variant.available_commands === null) {
				throw new Error(
					`Missing available_commands for available_commands_update event ${event.id}`,
				);
			}
			return {
				sessionUpdate: 'available_commands_update',
				...(meta !== undefined ? { _meta: meta } : {}),
				availableCommands: variant.available_commands,
			} as SessionUpdate;
		}

		case 'current_mode_update': {
			if (variant.current_mode_id === null) {
				throw new Error(
					`Missing current_mode_id for current_mode_update event ${event.id}`,
				);
			}
			return {
				sessionUpdate: 'current_mode_update',
				...(meta !== undefined ? { _meta: meta } : {}),
				currentModeId: variant.current_mode_id,
			} as SessionUpdate;
		}

		case 'config_option_update': {
			if (variant.config_options === null) {
				throw new Error(
					`Missing config_options for config_option_update event ${event.id}`,
				);
			}
			return {
				sessionUpdate: 'config_option_update',
				...(meta !== undefined ? { _meta: meta } : {}),
				configOptions: variant.config_options,
			} as SessionUpdate;
		}

		case 'session_info_update': {
			return {
				sessionUpdate: 'session_info_update',
				...(meta !== undefined ? { _meta: meta } : {}),
				title: variant.title ?? undefined,
				updatedAt: variant.updated_at ?? undefined,
			} as SessionUpdate;
		}

		case 'usage_update': {
			if (variant.size === null || variant.used === null) {
				throw new Error(`Missing size/used for usage_update event ${event.id}`);
			}
			return {
				sessionUpdate: 'usage_update',
				...(meta !== undefined ? { _meta: meta } : {}),
				size: variant.size,
				used: variant.used,
				cost:
					variant.cost_amount !== null && variant.cost_currency !== null
						? { amount: variant.cost_amount, currency: variant.cost_currency }
						: undefined,
			} as SessionUpdate;
		}

		case 'plan_update': {
			const row = variant.plan_update_events;
			if (row === null) {
				throw new Error(`Missing plan_update row for event ${event.id}`);
			}
			const plan = (() => {
				switch (row.plan_type) {
					case 'items':
						if (row.entries === null) {
							throw new Error(
								`Missing entries for plan_update event ${event.id}`,
							);
						}
						return { type: 'items', planId: row.plan_id, entries: row.entries };
					case 'file':
						if (row.uri === null) {
							throw new Error(`Missing uri for plan_update event ${event.id}`);
						}
						return { type: 'file', planId: row.plan_id, uri: row.uri };
					case 'markdown':
						if (row.markdown === null) {
							throw new Error(
								`Missing markdown for plan_update event ${event.id}`,
							);
						}
						return {
							type: 'markdown',
							planId: row.plan_id,
							content: row.markdown,
						};
				}
			})();
			return {
				sessionUpdate: 'plan_update',
				...(meta !== undefined ? { _meta: meta } : {}),
				plan,
			} as SessionUpdate;
		}

		case 'plan_removed': {
			const row = variant.plan_removed_events;
			if (row === null) {
				throw new Error(`Missing plan_removed row for event ${event.id}`);
			}
			return {
				sessionUpdate: 'plan_removed',
				...(meta !== undefined ? { _meta: meta } : {}),
				planId: row.plan_id,
			} as SessionUpdate;
		}

		case 'compaction_update': {
			const row = variant.compaction_update_events;
			if (row === null) {
				throw new Error(`Missing compaction_update row for event ${event.id}`);
			}
			return {
				sessionUpdate: 'compaction_update',
				...(meta !== undefined ? { _meta: meta } : {}),
				compactionId: row.compaction_id,
				status: row.status,
				summary: fromPatchColumn(row.summary),
				error: fromPatchColumn(row.error),
			} as SessionUpdate;
		}

		case 'compaction_summary_chunk': {
			const row = variant.compaction_summary_chunk_events;
			if (row === null) {
				throw new Error(
					`Missing compaction_summary_chunk row for event ${event.id}`,
				);
			}
			return {
				sessionUpdate: 'compaction_summary_chunk',
				...(meta !== undefined ? { _meta: meta } : {}),
				compactionId: row.compaction_id,
				content: row.content,
			} as SessionUpdate;
		}

		case 'notice': {
			const row = variant.notice_events;
			if (row === null) {
				throw new Error(`Missing notice row for event ${event.id}`);
			}
			return {
				sessionUpdate: 'notice',
				...(meta !== undefined ? { _meta: meta } : {}),
				severity: row.severity,
				title: row.title,
				description: fromPatchColumn(row.description),
			} as SessionUpdate;
		}

		case 'subagent_update': {
			const row = variant.subagent_update_events;
			if (row === null) {
				throw new Error(`Missing subagent_update row for event ${event.id}`);
			}
			return {
				sessionUpdate: 'subagent_update',
				...(meta !== undefined ? { _meta: meta } : {}),
				sessionId: row.child_session_id,
				title: fromPatchColumn(row.title),
				description: fromPatchColumn(row.description),
				capabilities: fromPatchColumn(row.capabilities),
				state: fromPatchColumn(row.state),
			} as SessionUpdate;
		}

		case 'session_message': {
			const row = variant.session_message_events;
			if (row === null) {
				throw new Error(`Missing session_message row for event ${event.id}`);
			}
			return {
				sessionUpdate: 'session_message',
				...(meta !== undefined ? { _meta: meta } : {}),
				messageId: row.message_id,
				senderSessionId: fromPatchColumn(row.sender_session_id),
				recipientSessionId: fromPatchColumn(row.recipient_session_id),
				content: fromPatchColumn(row.content),
			} as SessionUpdate;
		}

		case 'session_message_chunk': {
			const row = variant.session_message_chunk_events;
			if (row === null) {
				throw new Error(
					`Missing session_message_chunk row for event ${event.id}`,
				);
			}
			return {
				sessionUpdate: 'session_message_chunk',
				...(meta !== undefined ? { _meta: meta } : {}),
				messageId: row.message_id,
				senderSessionId: fromPatchColumn(row.sender_session_id),
				recipientSessionId: fromPatchColumn(row.recipient_session_id),
				content: row.content,
			} as SessionUpdate;
		}

		case 'cursor_extension': {
			return {
				sessionUpdate: 'cursor_extension',
				...(meta !== undefined ? { _meta: meta } : {}),
				method: typeof meta?.method === 'string' ? meta.method : '',
				params: meta?.params,
			} as unknown as SessionUpdate;
		}

		default: {
			const unhandled: never = event.type;
			throw new Error(`Unknown event type: ${String(unhandled)}`);
		}
	}
}
