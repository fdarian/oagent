export function JobEmptyState() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-22 text-muted-foreground">
			<p className="text-body font-light">No job selected</p>
			<p className="text-caption">
				Select a job from the sidebar to view its timeline
			</p>
		</div>
	);
}
