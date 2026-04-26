import type { AcpRuntimeEvent } from 'acpx/runtime';
import type { Jobs } from '#/jobs';

const CSS = `
  body { font-family: system-ui, sans-serif; margin: 0; background: #0f0f0f; color: #e0e0e0; }
  h1 { font-size: 1.2rem; padding: 1rem 1.5rem; margin: 0; background: #1a1a1a; border-bottom: 1px solid #333; }
  h2 { font-size: 1rem; margin: 0 0 0.75rem; }
  .container { padding: 1.5rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #222; font-size: 0.875rem; }
  th { color: #999; font-weight: 500; }
  a { color: #60a5fa; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
  .badge-running { background: #1d4ed8; color: #bfdbfe; }
  .badge-done    { background: #166534; color: #bbf7d0; }
  .badge-error   { background: #991b1b; color: #fecaca; }
  .event-log { background: #111; border: 1px solid #222; border-radius: 6px; padding: 1rem; font-family: monospace; font-size: 0.8rem; max-height: 70vh; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
  .event-row { margin-bottom: 0.4rem; line-height: 1.5; }
  .event-ts { color: #6b7280; margin-right: 0.5rem; }
  .event-type { font-weight: 600; margin-right: 0.5rem; }
  .event-type-text_delta { color: #34d399; }
  .event-type-thought { color: #a78bfa; }
  .event-type-tool_call { color: #fbbf24; }
  .event-type-status { color: #60a5fa; }
  .event-type-done { color: #86efac; }
  .event-type-error { color: #f87171; }
  .event-payload { color: #d1d5db; }
  .meta { color: #6b7280; font-size: 0.8rem; margin-bottom: 1rem; }
  .empty { color: #6b7280; font-style: italic; }
`.trim();

const HTML_SHELL = (title: string, body: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>`;

function formatAge(ms: number): string {
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function badgeHtml(status: string): string {
  return `<span class="badge badge-${status}">${status}</span>`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function renderEvent(event: AcpRuntimeEvent): string {
  const ts = new Date().toISOString().slice(11, 23);
  const typeClass =
    event.type === 'text_delta' && event.stream === 'thought'
      ? 'event-type-thought'
      : `event-type-${event.type}`;
  const typeLabel =
    event.type === 'text_delta' && event.stream === 'thought'
      ? 'thought'
      : event.type;

  let payload = '';
  if (event.type === 'text_delta') {
    payload = escapeHtml(truncate(event.text, 200));
  } else if (event.type === 'tool_call') {
    const parts = [];
    if (event.title !== undefined) parts.push(event.title);
    if (event.status !== undefined) parts.push(`[${event.status}]`);
    if (parts.length === 0) parts.push(truncate(event.text, 120));
    payload = escapeHtml(parts.join(' '));
  } else if (event.type === 'status') {
    payload = escapeHtml(truncate(event.text, 120));
  } else if (event.type === 'done') {
    payload =
      event.stopReason !== undefined ? escapeHtml(event.stopReason) : '';
  } else if (event.type === 'error') {
    const code = event.code !== undefined ? `[${event.code}] ` : '';
    payload = escapeHtml(`${code}${event.message}`);
  }

  return `<div class="event-row"><span class="event-ts">${ts}</span><span class="event-type ${typeClass}">${typeLabel}</span><span class="event-payload">${payload}</span></div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function handleJobList(jobs: Jobs): Response {
  const entries = jobs.list();
  const rows =
    entries.length === 0
      ? '<tr><td colspan="4" class="empty">No jobs yet.</td></tr>'
      : entries
          .map(
            (entry) =>
              `<tr>
                <td><a href="/jobs/${entry.id}">${truncate(entry.id, 20)}</a></td>
                <td>${badgeHtml(entry.status)}</td>
                <td>${formatAge(entry.createdAt)}</td>
                <td>${entry.terminatedAt !== undefined ? formatAge(entry.terminatedAt) : '—'}</td>
              </tr>`,
          )
          .join('\n');

  const html = HTML_SHELL(
    'opencode-mcp jobs',
    `<h1>opencode-mcp</h1>
<div class="container">
  <h2>Jobs</h2>
  <table>
    <thead><tr><th>ID</th><th>Status</th><th>Started</th><th>Finished</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`,
  );

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export function handleJobDetail(jobs: Jobs, jobId: string): Response {
  const detail = jobs.getDetail(jobId);
  if (detail === undefined) {
    return new Response('Job not found', { status: 404 });
  }

  const eventsHtml =
    detail.recentEvents.length === 0
      ? '<div class="empty">No events yet.</div>'
      : detail.recentEvents.map(renderEvent).join('');

  const isRunning = detail.status === 'running';

  const liveScript = isRunning
    ? `<script type="module">
const log = document.getElementById('event-log');
function scrollToBottom() { log.scrollTop = log.scrollHeight; }
function appendEvent(event) {
  const ts = new Date().toISOString().slice(11, 23);
  const typeLabel = (event.type === 'text_delta' && event.stream === 'thought') ? 'thought' : event.type;
  const typeClass = (event.type === 'text_delta' && event.stream === 'thought') ? 'event-type-thought' : 'event-type-' + event.type;
  let payload = '';
  if (event.type === 'text_delta') payload = (event.text || '').slice(0, 200);
  else if (event.type === 'tool_call') payload = [event.title, event.status ? '[' + event.status + ']' : ''].filter(Boolean).join(' ') || (event.text || '').slice(0, 120);
  else if (event.type === 'status') payload = (event.text || '').slice(0, 120);
  else if (event.type === 'done') payload = event.stopReason || '';
  else if (event.type === 'error') payload = (event.code ? '[' + event.code + '] ' : '') + (event.message || '');
  const div = document.createElement('div');
  div.className = 'event-row';
  div.innerHTML = '<span class="event-ts">' + ts + '</span><span class="event-type ' + typeClass + '">' + typeLabel + '</span><span class="event-payload">' + payload.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>';
  log.appendChild(div);
  scrollToBottom();
}
const es = new EventSource('/jobs/${jobId}/events');
es.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data === '__terminal__') { es.close(); document.getElementById('status-badge').outerHTML = '<span class="badge badge-done">done</span>'; return; }
  appendEvent(data);
};
es.onerror = () => es.close();
scrollToBottom();
</script>`
    : '';

  const html = HTML_SHELL(
    `job ${truncate(jobId, 12)} — opencode-mcp`,
    `<h1>opencode-mcp</h1>
<div class="container">
  <p class="meta">
    <a href="/">← all jobs</a> &nbsp;|&nbsp;
    Job <strong>${jobId}</strong> &nbsp;
    <span id="status-badge">${badgeHtml(detail.status)}</span>
    &nbsp;started ${formatAge(detail.createdAt)}
    ${detail.terminatedAt !== undefined ? `&nbsp;| finished ${formatAge(detail.terminatedAt)}` : ''}
  </p>
  <div id="event-log" class="event-log">${eventsHtml}</div>
</div>
${liveScript}`,
  );

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

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

      // Replay ring buffer to catch up
      for (const event of detail.recentEvents) {
        controller.enqueue(encode(event));
      }

      // If job is already terminal, close immediately
      if (detail.status !== 'running') {
        controller.enqueue(encode('__terminal__'));
        controller.close();
        return;
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
