import type {
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolKind,
} from '@oagent/engine';

export type TimelinePart =
  | { kind: 'text'; id: string; text: string; createdAt: number }
  | {
      kind: 'reasoning';
      id: string;
      text: string;
      isStreaming: boolean;
      createdAt: number;
      durationMs?: number;
    }
  | {
      kind: 'tool';
      id: string;
      toolCallId: string;
      toolName: string;
      title: string;
      state:
        | 'input-streaming'
        | 'input-available'
        | 'output-available'
        | 'output-error';
      toolKind?: ToolKind;
      content: ToolCallContent[];
      locations: ToolCallLocation[];
      createdAt: number;
      durationMs?: number;
    }
  | {
      kind: 'error';
      id: string;
      message: string;
      code?: string;
      createdAt: number;
    };

export type AdapterResult = {
  parts: TimelinePart[];
  lastStatus?: string;
};

function makeId(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

function mapToolState(
  status?: string | null,
): 'input-streaming' | 'input-available' | 'output-available' | 'output-error' {
  switch (status) {
    case 'pending':
      return 'input-streaming';
    case 'in_progress':
      return 'input-available';
    case 'completed':
      return 'output-available';
    case 'failed':
      return 'output-error';
    default:
      return 'input-streaming';
  }
}

type OpenText = {
  kind: 'text';
  id: string;
  text: string;
  createdAt: number;
  messageId?: string | null;
};

type OpenReasoning = {
  kind: 'reasoning';
  id: string;
  text: string;
  isStreaming: boolean;
  createdAt: number;
  messageId?: string | null;
};

function shouldContinueAccumulating(
  openPart: { messageId?: string | null } | null,
  chunkMessageId: string | null | undefined,
): boolean {
  if (openPart === null) return false;
  const openId = openPart.messageId;
  if (
    openId !== null &&
    openId !== undefined &&
    chunkMessageId !== null &&
    chunkMessageId !== undefined
  ) {
    return openId === chunkMessageId;
  }
  return true;
}

export function reduceEvents(events: SessionUpdate[]): AdapterResult {
  const parts: TimelinePart[] = [];
  let lastStatus: string | undefined;

  let openText: OpenText | null = null;
  let openReasoning: OpenReasoning | null = null;
  const toolIndices = new Map<string, number>();

  const now = Date.now();

  for (let i = 0; i < events.length; i++) {
    const update = events[i];
    if (update === undefined) continue;
    const createdAt = now - (events.length - 1 - i) * 100;

    const isAccumulatingChunk =
      update.sessionUpdate === 'agent_message_chunk' ||
      update.sessionUpdate === 'agent_thought_chunk';
    const isFlushOnlyChunk = update.sessionUpdate === 'user_message_chunk';

    if (!isAccumulatingChunk) {
      if (openText !== null) {
        parts.push(openText);
        openText = null;
      }
      if (openReasoning !== null) {
        const durationMs = createdAt - openReasoning.createdAt;
        parts.push({
          kind: 'reasoning',
          id: openReasoning.id,
          text: openReasoning.text,
          isStreaming: false,
          createdAt: openReasoning.createdAt,
          durationMs,
        });
        openReasoning = null;
      }
    }

    if (isFlushOnlyChunk) {
      continue;
    }

    if (update.sessionUpdate === 'agent_message_chunk') {
      const chunkMessageId = update.messageId;
      const contentBlock = update.content;
      const chunkText =
        contentBlock.type === 'text' ? contentBlock.text : undefined;

      if (openReasoning !== null) {
        const durationMs = createdAt - openReasoning.createdAt;
        parts.push({
          kind: 'reasoning',
          id: openReasoning.id,
          text: openReasoning.text,
          isStreaming: false,
          createdAt: openReasoning.createdAt,
          durationMs,
        });
        openReasoning = null;
      }

      const shouldContinue = shouldContinueAccumulating(
        openText,
        chunkMessageId,
      );
      if (!shouldContinue && openText !== null) {
        parts.push(openText);
        openText = null;
      }

      if (chunkText !== undefined) {
        if (openText === null) {
          openText = {
            kind: 'text',
            id: makeId('text', i),
            text: chunkText,
            createdAt,
            messageId: chunkMessageId,
          };
        } else {
          openText = {
            kind: 'text',
            id: openText.id,
            text: openText.text + chunkText,
            createdAt: openText.createdAt,
            messageId: chunkMessageId,
          };
        }
      } else if (openText !== null) {
        openText = {
          kind: 'text',
          id: openText.id,
          text: openText.text,
          createdAt: openText.createdAt,
          messageId: chunkMessageId,
        };
      }

      continue;
    }

    if (update.sessionUpdate === 'agent_thought_chunk') {
      const chunkMessageId = update.messageId;
      const contentBlock = update.content;
      const chunkText =
        contentBlock.type === 'text' ? contentBlock.text : undefined;

      if (openText !== null) {
        parts.push(openText);
        openText = null;
      }

      const shouldContinue = shouldContinueAccumulating(
        openReasoning,
        chunkMessageId,
      );
      if (!shouldContinue && openReasoning !== null) {
        const durationMs = createdAt - openReasoning.createdAt;
        parts.push({
          kind: 'reasoning',
          id: openReasoning.id,
          text: openReasoning.text,
          isStreaming: false,
          createdAt: openReasoning.createdAt,
          durationMs,
        });
        openReasoning = null;
      }

      if (chunkText !== undefined) {
        if (openReasoning === null) {
          openReasoning = {
            kind: 'reasoning',
            id: makeId('reasoning', i),
            text: chunkText,
            isStreaming: true,
            createdAt,
            messageId: chunkMessageId,
          };
        } else {
          openReasoning = {
            kind: 'reasoning',
            id: openReasoning.id,
            text: openReasoning.text + chunkText,
            isStreaming: openReasoning.isStreaming,
            createdAt: openReasoning.createdAt,
            messageId: chunkMessageId,
          };
        }
      } else if (openReasoning !== null) {
        openReasoning = {
          kind: 'reasoning',
          id: openReasoning.id,
          text: openReasoning.text,
          isStreaming: openReasoning.isStreaming,
          createdAt: openReasoning.createdAt,
          messageId: chunkMessageId,
        };
      }

      continue;
    }

    if (update.sessionUpdate === 'tool_call') {
      const toolCallId = update.toolCallId;
      const existingIndex = toolIndices.get(toolCallId);
      const newState = mapToolState(update.status);
      if (existingIndex === undefined) {
        toolIndices.set(toolCallId, parts.length);
        parts.push({
          kind: 'tool',
          id: `tool-${toolCallId}`,
          toolCallId,
          toolName: update.title,
          title: update.title,
          state: newState,
          toolKind: update.kind ?? undefined,
          content: update.content ?? [],
          locations: update.locations ?? [],
          createdAt,
        });
      } else {
        const existing = parts[existingIndex];
        if (existing === undefined || existing.kind !== 'tool') continue;
        const durationMs =
          (newState === 'output-available' || newState === 'output-error') &&
          existing.durationMs === undefined
            ? createdAt - existing.createdAt
            : existing.durationMs;
        parts[existingIndex] = {
          kind: 'tool',
          id: existing.id,
          toolCallId: existing.toolCallId,
          toolName: existing.toolName,
          title: update.title,
          state: newState,
          toolKind: update.kind ?? existing.toolKind,
          content: update.content ?? existing.content,
          locations: update.locations ?? existing.locations,
          createdAt: existing.createdAt,
          durationMs,
        };
      }
      continue;
    }

    if (update.sessionUpdate === 'tool_call_update') {
      const toolCallId = update.toolCallId;
      const existingIndex = toolIndices.get(toolCallId);
      if (existingIndex === undefined) continue;
      const existing = parts[existingIndex];
      if (existing === undefined || existing.kind !== 'tool') continue;
      const nextTitle =
        update.title !== null && update.title !== undefined
          ? update.title
          : existing.title;
      const nextState =
        update.status !== null && update.status !== undefined
          ? mapToolState(update.status)
          : existing.state;
      const nextToolKind =
        update.kind !== null && update.kind !== undefined
          ? update.kind
          : existing.toolKind;
      const nextContent =
        update.content !== null && update.content !== undefined
          ? update.content
          : existing.content;
      const nextLocations =
        update.locations !== null && update.locations !== undefined
          ? update.locations
          : existing.locations;
      const durationMs =
        (nextState === 'output-available' || nextState === 'output-error') &&
        existing.durationMs === undefined
          ? createdAt - existing.createdAt
          : existing.durationMs;
      parts[existingIndex] = {
        kind: 'tool',
        id: existing.id,
        toolCallId: existing.toolCallId,
        toolName: existing.toolName,
        title: nextTitle,
        state: nextState,
        toolKind: nextToolKind,
        content: nextContent,
        locations: nextLocations,
        createdAt: existing.createdAt,
        durationMs,
      };
    }

    // Ignored variants: plan, available_commands_update, current_mode_update,
    // config_option_update, session_info_update, usage_update
    // Open text/reasoning already flushed above.
  }

  if (openText !== null) {
    parts.push(openText);
  }
  if (openReasoning !== null) {
    const durationMs = now - openReasoning.createdAt;
    parts.push({
      kind: 'reasoning',
      id: openReasoning.id,
      text: openReasoning.text,
      isStreaming: false,
      createdAt: openReasoning.createdAt,
      durationMs,
    });
  }
  for (let j = parts.length - 1; j >= 0; j--) {
    const part = parts[j];
    if (part === undefined) continue;
    if (
      part.kind === 'tool' &&
      (part.state === 'input-streaming' || part.state === 'input-available')
    ) {
      lastStatus = `Running tool: ${part.title}`;
      break;
    }
  }

  return { parts, lastStatus };
}
