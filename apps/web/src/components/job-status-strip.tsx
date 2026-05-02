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
      setDots((prev) => (prev.length >= 3 ? '' : `${prev}.`));
    }, 500);
    return () => clearInterval(interval);
  }, [isRunning]);

  if (!isRunning) return null;

  return (
    <div className="flex items-center gap-[var(--element-gap)] bg-[var(--color-status-strip)] px-[var(--card-padding)] py-[var(--element-gap)] text-[var(--text-caption)] text-[var(--color-ink)]">
      <span className="font-medium uppercase tracking-wide">
        Agent is working
      </span>
      <span className="font-light">{dots}</span>
      {status !== undefined && status !== '' && (
        <span className="font-light text-[var(--color-graphite)]">
          — {status}
        </span>
      )}
    </div>
  );
}
