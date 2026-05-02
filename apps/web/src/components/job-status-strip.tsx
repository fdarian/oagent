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
    <div className="flex items-center gap-15 bg-status-strip px-22 py-15 text-caption text-foreground">
      <span className="font-medium uppercase tracking-wide">
        Agent is working
      </span>
      <span className="font-light">{dots}</span>
      {status !== undefined && status !== '' && (
        <span className="font-light text-graphite">
          — {status}
        </span>
      )}
    </div>
  );
}
