import fs from 'node:fs';
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

      // If job is already terminal, replay full ndjson log and close
      if (detail.status !== 'running') {
        try {
          const lines = fs.readFileSync(detail.ndjsonPath, 'utf8').split('\n');
          for (const line of lines) {
            if (line.trim() === '') continue;
            controller.enqueue(encode(JSON.parse(line)));
          }
        } catch {
          // Fall back to ring buffer if file is unavailable
          for (const event of detail.recentEvents) {
            controller.enqueue(encode(event));
          }
        }
        controller.enqueue(encode('__terminal__'));
        controller.close();
        return;
      }

      // Replay ring buffer to catch up for running jobs
      for (const event of detail.recentEvents) {
        controller.enqueue(encode(event));
      }

      // `closed` is mutable flag state, not deferred initialization — let is intentional.
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

      const unsubscribe = jobs.subscribe(jobId, (event) => {
        if (event === '__terminal__') {
          safeEnqueue(encode('__terminal__'));
          safeClose();
          unsubscribe();
          signal.removeEventListener('abort', onAbort);
          return;
        }
        safeEnqueue(encode(event));
      });

      const onAbort = () => {
        unsubscribe();
        safeClose();
      };

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
