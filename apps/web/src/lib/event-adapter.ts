type AcpEvent =
  | { type: 'text_delta'; text?: string; stream?: 'output' | 'thought'; tag?: string }
  | { type: 'status'; text: string; tag?: string; used?: number; size?: number }
  | {
      type: 'tool_call';
      text?: string;
      tag?: string;
      toolCallId?: string;
      status?: string;
      title?: string;
    }
  | { type: 'done'; stopReason?: string }
  | { type: 'error'; message: string; code?: string; retryable?: boolean };

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
      title: string;
      state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
      body: string;
      createdAt: number;
      durationMs?: number;
    }
  | { kind: 'error'; id: string; message: string; code?: string; createdAt: number };

export type AdapterResult = {
  parts: TimelinePart[];
  lastStatus?: string;
  terminalReason?: 'done' | 'error';
};

function makeId(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

function hashToolId(
  event: Extract<AcpEvent, { type: 'tool_call' }>,
  index: number,
): string {
  if (event.toolCallId !== undefined && event.toolCallId !== '') {
    return event.toolCallId;
  }
  const key = `${event.title ?? ''}:${event.text ?? ''}:${event.tag ?? ''}:${index}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `tool-${Math.abs(hash).toString(36)}`;
}

function mapToolState(status?: string): 'input-streaming' | 'input-available' | 'output-available' | 'output-error' {
  switch (status) {
    case 'pending':
      return 'input-streaming';
    case 'running':
      return 'input-available';
    case 'completed':
      return 'output-available';
    case 'error':
      return 'output-error';
    default:
      return 'input-streaming';
  }
}

/**
 * Pure, re-runnable reducer: given the full event list (SSE replay or live tail),
 * rebuilds the timeline from scratch so seed and incremental updates are identical.
 */
export function reduceEvents(events: AcpEvent[]): AdapterResult {
  const parts: TimelinePart[] = [];
  let lastStatus: string | undefined;
  let terminalReason: 'done' | 'error' | undefined;

  // Mutable builders for the "open" parts we are currently accumulating
  let openText: TimelinePart & { kind: 'text' } | null = null;
  let openReasoning: TimelinePart & { kind: 'reasoning' } | null = null;
  const openTools = new Map<string, TimelinePart & { kind: 'tool' }>();

  const now = Date.now();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev === undefined) continue;
    const createdAt = now - (events.length - 1 - i) * 100;

    if (ev.type === 'text_delta') {
      if (ev.stream === 'thought') {
        // Close any open text part first
        if (openText !== null) {
          parts.push(openText);
          openText = null;
        }
        if (openReasoning === null) {
          openReasoning = {
            kind: 'reasoning',
            id: makeId('reasoning', i),
            text: ev.text ?? '',
            isStreaming: true,
            createdAt,
          };
        } else {
          openReasoning = {
            kind: 'reasoning',
            id: openReasoning.id,
            text: openReasoning.text + (ev.text ?? ''),
            isStreaming: openReasoning.isStreaming,
            createdAt: openReasoning.createdAt,
          };
        }
      } else {
        // output or undefined
        // Close any open reasoning part first
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
        if (openText === null) {
          openText = {
            kind: 'text',
            id: makeId('text', i),
            text: ev.text ?? '',
            createdAt,
          };
        } else {
          openText = {
            kind: 'text',
            id: openText.id,
            text: openText.text + (ev.text ?? ''),
            createdAt: openText.createdAt,
          };
        }
      }
      continue;
    }

    // Any non-text_delta event closes open text and reasoning
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

    if (ev.type === 'tool_call') {
      const toolCallId = hashToolId(ev, i);
      const existing = openTools.get(toolCallId);
      const newState = mapToolState(ev.status);
      if (existing === undefined) {
        openTools.set(toolCallId, {
          kind: 'tool',
          id: makeId('tool', i),
          toolCallId,
          title: ev.title ?? 'Tool',
          state: newState,
          body: ev.text ?? '',
          createdAt,
        });
      } else {
        const durationMs =
          newState === 'output-available' || newState === 'output-error'
            ? createdAt - existing.createdAt
            : existing.durationMs;
        openTools.set(toolCallId, {
          kind: 'tool',
          id: existing.id,
          toolCallId: existing.toolCallId,
          title: ev.title ?? existing.title,
          state: newState,
          body: ev.text ?? existing.body,
          createdAt: existing.createdAt,
          durationMs,
        });
      }
      continue;
    }

    if (ev.type === 'status') {
      lastStatus = ev.text;
      continue;
    }

    if (ev.type === 'done') {
      terminalReason = 'done';
      continue;
    }

    if (ev.type === 'error') {
      terminalReason = 'error';
      parts.push({
        kind: 'error',
        id: makeId('error', i),
        message: ev.message,
        code: ev.code,
        createdAt,
      });
      continue;
    }
  }

  // Flush remaining open parts at end of event list
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
  for (const tool of openTools.values()) {
    parts.push(tool);
  }

  return { parts, lastStatus, terminalReason };
}
