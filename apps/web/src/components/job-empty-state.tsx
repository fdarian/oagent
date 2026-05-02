export function JobEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[var(--spacing-22)] text-[var(--color-smoke)]">
      <p className="text-[var(--text-body)] font-[var(--font-weight-light)]">
        No job selected
      </p>
      <p className="text-[var(--text-caption)]">
        Select a job from the sidebar to view its timeline
      </p>
    </div>
  );
}
