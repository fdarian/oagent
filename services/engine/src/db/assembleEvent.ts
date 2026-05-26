import type {
	AvailableCommand,
	ContentBlock,
	PlanEntry,
	SessionConfigOption,
	SessionUpdate,
	ToolCallLocation,
} from '@agentclientprotocol/sdk';

type EventRow = {
	id: number;
	job_id: number;
	created_at: Date;
	type: string;
	meta: Record<string, unknown> | null;
};

type VariantRow = {
	message_id: string | null;
	content: ContentBlock | null;
	tool_call_id: string | null;
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
};

export function assembleEvent(
	event: EventRow,
	variant: VariantRow,
): SessionUpdate {
	const meta = event.meta ?? undefined;

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
				title: variant.title ?? undefined,
				status: variant.status ?? undefined,
				kind: variant.kind ?? undefined,
				content: variant.content ?? undefined,
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

		case 'cursor_extension': {
			return {
				sessionUpdate: 'cursor_extension',
				...(meta !== undefined ? { _meta: meta } : {}),
				method:
					typeof meta?.method === 'string' ? meta.method : '',
				params: meta?.params,
			} as unknown as SessionUpdate;
		}

		default:
			throw new Error(`Unknown event type: ${event.type}`);
	}
}
