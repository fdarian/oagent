import { CopyIcon, XCircleIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatAge, formatElapsed } from '@/lib/format';

export type JobHeaderProps = {
  id: string;
  status: string;
  prompt: string;
  cwd: string;
  model?: string;
  createdAt: number;
  terminatedAt?: number;
  onCancel?: () => void;
};

export function JobHeader({
  id,
  status,
  prompt,
  cwd,
  model,
  createdAt,
  terminatedAt,
  onCancel,
}: JobHeaderProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [id]);

  const promptLines = prompt.split('\n').slice(0, 2).join('\n');
  const elapsed = formatElapsed(createdAt, terminatedAt);

  const statusDot =
    status === 'running' ? (
      <span className="inline-block h-[6px] w-[6px] bg-[var(--color-verdant-accent)]" />
    ) : status === 'done' ? (
      <span className="inline-block h-[6px] w-[6px] bg-[var(--color-electric-blue)]" />
    ) : (
      <span className="inline-block h-[6px] w-[6px] bg-[var(--color-terracotta)]" />
    );

  return (
    <div className="flex flex-col gap-[var(--element-gap)] border-b border-[var(--color-steel)] pb-[var(--spacing-22)]">
      <div className="flex items-start justify-between gap-[var(--element-gap)]">
        <div className="flex min-w-0 flex-1 flex-col gap-[var(--element-gap)]">
          <pre className="whitespace-pre-wrap font-[var(--font-sans)] text-[var(--text-body)] font-[var(--font-weight-light)] leading-[var(--text-body--line-height)] text-[var(--color-ink)]">
            {promptLines}
          </pre>
          <div className="flex items-center gap-[var(--element-gap)] text-[var(--text-caption)] text-[var(--color-smoke)]">
            <span className="truncate">{cwd}</span>
            <span>·</span>
            <span>started {formatAge(createdAt)}</span>
            <span>·</span>
            <span>{elapsed}</span>
            {model !== undefined && model !== '' && (
              <>
                <span>·</span>
                <span>{model}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-[var(--element-gap)]">
          <div
            className={cn(
              'flex items-center gap-[6px] border px-2 py-1 text-[var(--text-caption)]',
              status === 'running'
                ? 'border-[var(--color-verdant-accent)] text-[var(--color-verdant-accent)]'
                : status === 'done'
                  ? 'border-[var(--color-electric-blue)] text-[var(--color-electric-blue)]'
                  : 'border-[var(--color-terracotta)] text-[var(--color-terracotta)]',
            )}
          >
            {statusDot}
            <span className="uppercase">{status}</span>
          </div>
          {status === 'running' && onCancel !== undefined && (
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1 border border-[var(--color-terracotta)] px-2 py-1 text-[var(--text-caption)] text-[var(--color-terracotta)] transition-colors hover:bg-[var(--color-terracotta)] hover:text-[var(--color-canvas)]"
            >
              <XCircleIcon className="h-3 w-3" />
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleCopyId}
            className="flex items-center gap-1 border border-[var(--color-steel)] px-2 py-1 text-[var(--text-caption)] text-[var(--color-smoke)] transition-colors hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
          >
            <CopyIcon className="h-3 w-3" />
            {copied ? 'Copied' : 'ID'}
          </button>
        </div>
      </div>
    </div>
  );
}
