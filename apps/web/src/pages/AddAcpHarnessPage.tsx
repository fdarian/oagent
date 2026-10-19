import { useNavigate } from '@tanstack/react-router';
import { CustomHarnessForm } from '@/components/custom-harness-form';

export function AddAcpHarnessPage() {
	const navigate = useNavigate();

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="flex items-center justify-between border-b border-border px-22 py-15">
				<span className="text-subheading font-light text-foreground">
					Add ACP harness
				</span>
			</header>
			<main className="flex-1 overflow-y-auto px-33 py-22">
				<div className="mx-auto grid max-w-[900px] gap-6">
					<p className="max-w-xl text-sm text-muted-foreground">
						Register any agent that speaks the Agent Client Protocol over stdio.
						Once saved it works like a built-in harness in models, aliases and
						environment settings.
					</p>
					<CustomHarnessForm
						onSaved={(harness) => {
							void navigate({
								to: '/settings/harnesses/$backend',
								params: { backend: harness.id },
							});
						}}
					/>
				</div>
			</main>
		</div>
	);
}
