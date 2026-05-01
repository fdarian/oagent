import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { orpc } from '../lib/orpc.ts';

interface JobDetailProps {
  jobId: string;
  onBack: () => void;
}

type EventItem = {
  type: string;
  stream?: string;
  text?: string;
  title?: string;
  status?: string;
  stopReason?: string;
  code?: string;
  message?: string;
};

type LogEntry = { id: number; at: number; event: EventItem };

export function JobDetail({ jobId, onBack }: JobDetailProps) {
  const queryClient = useQueryClient();
  const { data: job } = useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => orpc.jobs.get({ jobId }),
  });

  const [events, setEvents] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(0);

  useEffect(() => {
    const source = new EventSource(`/jobs/${jobId}/events`);

    source.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data === '__terminal__') {
        source.close();
        queryClient.invalidateQueries({ queryKey: ['jobs', jobId] });
        return;
      }
      nextIdRef.current += 1;
      setEvents((prev) => [
        ...prev,
        { id: nextIdRef.current, at: Date.now(), event: data },
      ]);
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [jobId, queryClient]);

  useEffect(() => {
    if (logRef.current && events.length > 0) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events.length]);

  const detail = job;

  return (
    <div className="p-6">
      <p className="text-sm text-gray-400 mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-blue-400 hover:underline mr-2"
        >
          ← all jobs
        </button>
        | Job <strong className="text-gray-200">{jobId}</strong>{' '}
        {detail !== undefined && detail !== null && (
          <>
            {statusBadge(detail.status)}
            <span className="ml-2">started {formatAge(detail.createdAt)}</span>
            {detail.terminatedAt !== undefined && (
              <span className="ml-2">
                | finished {formatAge(detail.terminatedAt)}
              </span>
            )}
          </>
        )}
      </p>
      <div
        ref={logRef}
        className="bg-[#111] border border-gray-800 rounded-md p-4 font-mono text-xs max-h-[70vh] overflow-y-auto"
      >
        {events.length === 0 ? (
          <p className="text-gray-500 italic">No events yet.</p>
        ) : (
          events.map((entry) => (
            <div key={entry.id} className="mb-1 leading-relaxed">
              <span className="text-gray-600 mr-2">
                {new Date(entry.at).toISOString().slice(11, 23)}
              </span>
              <span
                className={`font-semibold mr-2 ${eventTypeColor(entry.event)}`}
              >
                {eventLabel(entry.event)}
              </span>
              <span className="text-gray-300">{eventPayload(entry.event)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function statusBadge(status: string) {
  const classes: Record<string, string> = {
    running: 'bg-blue-900 text-blue-200',
    done: 'bg-green-900 text-green-200',
    error: 'bg-red-900 text-red-200',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${classes[status] ?? 'bg-gray-800 text-gray-300'}`}
    >
      {status}
    </span>
  );
}

function formatAge(ms: number): string {
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function eventLabel(event: EventItem): string {
  if (event.type === 'text_delta' && event.stream === 'thought')
    return 'thought';
  return event.type;
}

function eventTypeColor(event: EventItem): string {
  if (event.type === 'text_delta' && event.stream === 'thought')
    return 'text-purple-400';
  if (event.type === 'text_delta') return 'text-green-400';
  if (event.type === 'tool_call') return 'text-yellow-400';
  if (event.type === 'status') return 'text-blue-400';
  if (event.type === 'done') return 'text-green-300';
  if (event.type === 'error') return 'text-red-400';
  return 'text-gray-400';
}

function eventPayload(event: EventItem): string {
  if (event.type === 'text_delta') {
    return (event.text ?? '').slice(0, 200);
  }
  if (event.type === 'tool_call') {
    const parts = [event.title, event.status ? `[${event.status}]` : ''].filter(
      Boolean,
    );
    return parts.join(' ') || (event.text ?? '').slice(0, 120);
  }
  if (event.type === 'status') {
    return (event.text ?? '').slice(0, 120);
  }
  if (event.type === 'done') {
    return event.stopReason ?? '';
  }
  if (event.type === 'error') {
    const code = event.code ? `[${event.code}] ` : '';
    return `${code}${event.message ?? ''}`;
  }
  return '';
}
