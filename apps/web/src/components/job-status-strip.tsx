import { useEffect, useState } from 'react';

export type JobStatusStripProps = {
  status?: string;
  isRunning: boolean;
};

export function JobStatusStrip({ status, isRunning }: JobStatusStripProps) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, [isRunning]);

  if (!isRunning) {
    return (
      <div className="flex items-center gap-[var(--element-gap)] bg-[var(--color-status-strip)] px-[var(--card-padding)] py-[var(--element-gap)] text-[var(--text-caption)] text-[var(--color-ink)]">
        <span className="font-[var(--font-weight-thin)] uppercase tracking-wide">
          Idle
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-[var(--element-gap)] bg-[var(--color-status-strip)] px-[var(--card-padding)] py-[var(--element-gap)] text-[var(--text-caption)] text-[var(--color-ink)]">
      <span className="font-[var(--font-weight-thin)] uppercase tracking-wide">
        Agent is working
      </span>
      <span className="font-[var(--font-weight-light)]">{dots}</span>
      {status !== undefined && status !== '' && (
        <span className="font-[var(--font-weight-light)] text-[var(--color-smoke)]">
          — {status}
        </span>
      )}
    </div>
  );
}
