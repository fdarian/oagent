import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { Jobs } from '../jobs.ts';

export function handleJobEvents(
  jobs: Jobs,
  jobId: string,
  signal: AbortSignal,
): Response {
  const detail = jobs.getDetail(jobId);
  if (detail === undefined) {
    return new Response('Job not found', { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const safeEnqueue = (data: string) => {
        if (closed) return;
        controller.enqueue(data);
      };

      const buffer: Array<
        | { type: 'event'; event: SessionUpdate; sequence: number }
        | { type: 'terminal' }
      > = [];
      let maxSequence = 0;
      let live = false;

      let unsubscribe = (): void => {};
      const onAbort = (): void => {
        unsubscribe();
        safeClose();
      };

      const listener = (
        payload:
          | { type: 'event'; event: SessionUpdate; sequence: number }
          | { type: 'terminal' },
      ) => {
        if (live) {
          if (payload.type === 'terminal') {
            safeEnqueue(encode('__terminal__'));
            safeClose();
            unsubscribe();
            signal.removeEventListener('abort', onAbort);
            return;
          }
          if (payload.sequence > maxSequence) {
            maxSequence = payload.sequence;
            safeEnqueue(encode(payload.event));
          }
        } else {
          buffer.push(payload);
        }
      };

      unsubscribe = jobs.subscribe(jobId, listener);

      // Read history from DB
      const history = jobs.readEventsSince(jobId, 0);
      for (const item of history) {
        safeEnqueue(encode(item.event));
        if (item.sequence > maxSequence) maxSequence = item.sequence;
      }

      // Atomically switch to live and drain buffer
      live = true;
      let sawTerminal = false;
      for (const payload of buffer) {
        if (payload.type === 'terminal') {
          sawTerminal = true;
          safeEnqueue(encode('__terminal__'));
          safeClose();
          unsubscribe();
          signal.removeEventListener('abort', onAbort);
          return;
        }
        if (payload.sequence > maxSequence) {
          maxSequence = payload.sequence;
          safeEnqueue(encode(payload.event));
        }
      }
      buffer.length = 0;

      // Race fix: if job became terminal between subscribe and drain, we may have missed the emitter event.
      // Re-check status; if terminal, close now.
      const current = jobs.getDetail(jobId);
      if (current !== undefined && current.status !== 'running') {
        if (!sawTerminal) {
          safeEnqueue(encode('__terminal__'));
        }
        safeClose();
        unsubscribe();
        signal.removeEventListener('abort', onAbort);
        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}
