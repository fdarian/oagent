import { AlertCircleIcon } from 'lucide-react';
import type { TimelinePart } from '@/lib/event-adapter';

export type JobTimelineErrorProps = {
  part: Extract<TimelinePart, { kind: 'error' }>;
};

export function JobTimelineError({ part }: JobTimelineErrorProps) {
  return (
    <div className="flex flex-col gap-15 border border-destructive bg-[color-mix(in_srgb,var(--color-terracotta)_5%,var(--color-canvas))] p-22">
      <div className="flex items-center gap-15 text-destructive">
        <AlertCircleIcon className="h-4 w-4" />
        <span className="text-caption font-light uppercase tracking-wide">
          Error
        </span>
        {part.code !== undefined && (
          <span className="text-caption text-muted-foreground">
            [{part.code}]
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-body font-light text-foreground">
        {part.message}
      </p>
    </div>
  );
}
